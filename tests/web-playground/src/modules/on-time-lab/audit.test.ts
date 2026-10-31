import { describe, expect, it } from 'vitest'
import { auditOnTimeLab, CHECK_DRILLDOWN, CHECK_EXPORT, CHECK_NESTED_OR, CHECK_PIVOT, CHECK_ROOT, findTargetOrGroup } from './audit'
import { FLIGHT_RECORDS, INITIAL_TREE } from './data'
import {
  buildDetailCsv,
  buildPivot,
  createGroup,
  createRule,
  filterFlights,
  insertIntoGroup,
  matchesGroup,
  matchesRule,
  operatorsForField,
  removeNode,
  topDelayRow,
} from './engine'
import type { FilterGroup, FilterRule, OnTimeLabSnapshot } from './types'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function rule(
  field: FilterRule['field'],
  operator: FilterRule['operator'],
  value: string | number,
): FilterRule {
  const node = createRule(field)
  node.operator = operator
  node.value = value
  return node
}

function orGroup(children: FilterRule[]): FilterGroup {
  const group = createGroup()
  group.logic = 'OR'
  group.children = children
  return group
}

/** 任务简报要求的目标条件树 */
function targetTree(): FilterGroup {
  const tree = clone(INITIAL_TREE)
  tree.children = [
    rule('departureSlot', 'eq', '早高峰'),
    rule('loadFactor', 'gt', 70),
    orGroup([rule('delayRate', 'gt', 15), rule('complaints', 'gte', 3)]),
  ]
  return tree
}

function snapshot(overrides: Partial<OnTimeLabSnapshot> = {}): OnTimeLabSnapshot {
  return {
    root: targetTree(),
    pivotRows: null,
    drilledKey: null,
    exportedKey: null,
    ...overrides,
  }
}

describe('engine · 条件树求值', () => {
  const sample = FLIGHT_RECORDS[0]

  it('数字字段支持全部比较符', () => {
    const base = { flightNo: 'T1', departureSlot: '早高峰', region: '华东' } as const
    const record = { ...base, loadFactor: 75, delayRate: 16.2, complaints: 3 }
    expect(matchesRule(rule('delayRate', 'gt', 15), record)).toBe(true)
    expect(matchesRule(rule('delayRate', 'gt', 17), record)).toBe(false)
    expect(matchesRule(rule('complaints', 'gte', 3), record)).toBe(true)
    expect(matchesRule(rule('complaints', 'lt', 5), record)).toBe(true)
    expect(matchesRule(rule('complaints', 'lte', 2), record)).toBe(false)
    expect(matchesRule(rule('loadFactor', 'neq', 75), record)).toBe(false)
  })

  it('文本字段只支持相等性比较，其他操作符一律不命中', () => {
    expect(matchesRule(rule('departureSlot', 'eq', sample.departureSlot), sample)).toBe(true)
    expect(matchesRule(rule('departureSlot', 'neq', '平峰'), sample)).toBe(true)
    expect(matchesRule(rule('region', 'gt', '华东'), sample)).toBe(false)
    expect(matchesRule({ ...rule('region', 'eq', '华东'), value: 0 }, sample)).toBe(false)
  })

  it('空条件组恒真，AND/OR 语义正确', () => {
    const empty = createGroup()
    expect(matchesGroup(empty, sample)).toBe(true)

    const and = createGroup()
    and.children = [rule('loadFactor', 'gt', 100), rule('complaints', 'gte', 0)]
    expect(matchesGroup(and, sample)).toBe(false)

    const or = createGroup()
    or.logic = 'OR'
    or.children = [rule('loadFactor', 'gt', 100), rule('complaints', 'gte', 0)]
    expect(matchesGroup(or, sample)).toBe(true)
  })

  it('三层嵌套树按深度优先语义求值', () => {
    const inner = createGroup()
    inner.logic = 'OR'
    inner.children = [rule('region', 'eq', '西北'), rule('region', 'eq', '东北')]

    const middle = createGroup()
    middle.children = [inner, rule('delayRate', 'gt', 10)]

    const tree = createGroup()
    tree.children = [rule('departureSlot', 'eq', '早高峰'), middle]

    const hit = FLIGHT_RECORDS.find(
      (r) =>
        r.departureSlot === '早高峰' &&
        (r.region === '西北' || r.region === '东北') &&
        r.delayRate > 10,
    )
    expect(hit).toBeDefined()
    expect(matchesGroup(tree, hit!)).toBe(true)
    const miss = FLIGHT_RECORDS.find((r) => r.departureSlot !== '早高峰')
    expect(matchesGroup(tree, miss!)).toBe(false)
  })

  it('树操作：向嵌套子组插入并按 id 删除，根组不可删', () => {
    const tree = clone(INITIAL_TREE)
    const sub = createGroup()
    expect(insertIntoGroup(tree, tree.id, sub)).toBe(true)
    expect(insertIntoGroup(tree, 'no-such-id', createRule())).toBe(false)
    expect(insertIntoGroup(tree, sub.id, rule('delayRate', 'gt', 15))).toBe(true)
    expect(sub.children).toHaveLength(1)

    expect(removeNode(tree, tree.id)).toBe(false)
    expect(removeNode(tree, sub.children[0].id)).toBe(true)
    expect(removeNode(tree, sub.id)).toBe(true)
    expect(tree.children).toHaveLength(0)
  })

  it('操作符集合按字段类型收放', () => {
    expect(operatorsForField('region')).toEqual(['eq', 'neq'])
    expect(operatorsForField('delayRate')).toEqual(['eq', 'neq', 'gt', 'gte', 'lt', 'lte'])
  })
})

describe('engine · 过滤与透视聚合', () => {
  it('数据集规模与确定性：108 条且无重复航班号', () => {
    expect(FLIGHT_RECORDS.length).toBe(108)
    expect(new Set(FLIGHT_RECORDS.map((r) => r.flightNo)).size).toBe(108)
  })

  it('目标条件可筛出一批航班，且西北平均延误率显著最高', () => {
    const matched = filterFlights(FLIGHT_RECORDS, targetTree())
    expect(matched.length).toBeGreaterThanOrEqual(8)

    const rows = buildPivot(matched, 'region')
    expect(rows.length).toBeGreaterThan(1)
    const worst = topDelayRow(rows)
    expect(worst?.key).toBe('西北')
    const runnerUp = rows
      .filter((row) => row.key !== '西北')
      .reduce((max, row) => Math.max(max, row.avgDelayRate), 0)
    expect(worst!.avgDelayRate).toBeGreaterThan(runnerUp + 4)
  })

  it('透视行聚合数字正确', () => {
    const list = FLIGHT_RECORDS.filter((r) => r.region === '华东' && r.departureSlot === '早高峰')
    const rows = buildPivot(
      FLIGHT_RECORDS.filter((r) => r.region === '华东'),
      'departureSlot',
    )
    const morning = rows.find((row) => row.key === '早高峰')!
    expect(morning.flightCount).toBe(list.length)
    expect(morning.records).toEqual(list)
    const sumDelay = list.reduce((sum, r) => sum + r.delayRate, 0)
    expect(morning.avgDelayRate).toBe(Math.round((sumDelay / list.length) * 10) / 10)
    expect(morning.totalComplaints).toBe(list.reduce((sum, r) => sum + r.complaints, 0))
  })

  it('topDelayRow 空矩阵返回 null，出港时段维度同样可用', () => {
    expect(topDelayRow([])).toBeNull()
    const rows = buildPivot(filterFlights(FLIGHT_RECORDS, targetTree()), 'departureSlot')
    const worst = topDelayRow(rows)
    expect(worst).not.toBeNull()
    expect(['早高峰', '平峰', '晚高峰']).toContain(worst!.key)
  })

  it('CSV 报表含表头与全部命中行', () => {
    const matched = filterFlights(FLIGHT_RECORDS, targetTree())
    const csv = buildDetailCsv(matched)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('航班号,出港时段,航线区域,平均载客率(%),延误率(%),旅客投诉(次)')
    expect(lines).toHaveLength(matched.length + 1)
    expect(lines[1]).toContain(matched[0].flightNo)
  })
})

describe('auditOnTimeLab', () => {
  it('未操作的页面全部未通过', () => {
    const items = auditOnTimeLab(snapshot({ root: clone(INITIAL_TREE) }))
    expect(items.map((item) => item.result)).toEqual(['miss', 'miss', 'miss', 'miss', 'miss'])
  })

  it('条件树正确但未执行透视时，仅前两项通过', () => {
    const items = auditOnTimeLab(snapshot())
    expect(items.find((item) => item.key === CHECK_ROOT)?.result).toBe('ok')
    expect(items.find((item) => item.key === CHECK_NESTED_OR)?.result).toBe('ok')
    expect(items.find((item) => item.key === CHECK_PIVOT)?.result).toBe('miss')
    expect(items.find((item) => item.key === CHECK_DRILLDOWN)?.result).toBe('miss')
    expect(items.find((item) => item.key === CHECK_EXPORT)?.result).toBe('miss')
  })

  it('根组为 OR 时第一项不通过', () => {
    const tree = targetTree()
    tree.logic = 'OR'
    const items = auditOnTimeLab(snapshot({ root: tree }))
    expect(items.find((item) => item.key === CHECK_ROOT)?.result).toBe('miss')
  })

  it('载客率用大于等于 70 代替严格大于时不通过', () => {
    const tree = targetTree()
    const loadRule = tree.children.find(
      (child): child is FilterRule => child.kind === 'rule' && child.field === 'loadFactor',
    )!
    loadRule.operator = 'gte'
    const items = auditOnTimeLab(snapshot({ root: tree }))
    expect(items.find((item) => item.key === CHECK_ROOT)?.result).toBe('miss')
  })

  it('子组为 AND 而非 OR 时嵌套项不通过', () => {
    const tree = targetTree()
    const sub = tree.children.find((child): child is FilterGroup => child.kind === 'group')!
    sub.logic = 'AND'
    const items = auditOnTimeLab(snapshot({ root: tree }))
    expect(items.find((item) => item.key === CHECK_NESTED_OR)?.result).toBe('miss')
  })

  it('两条目标分支直接写在根组而不建 OR 子组时，嵌套项不通过', () => {
    const tree = clone(INITIAL_TREE)
    tree.children = [
      rule('departureSlot', 'eq', '早高峰'),
      rule('loadFactor', 'gt', 70),
      rule('delayRate', 'gt', 15),
      rule('complaints', 'gte', 3),
    ]
    const items = auditOnTimeLab(snapshot({ root: tree }))
    expect(items.find((item) => item.key === CHECK_ROOT)?.result).toBe('ok')
    expect(items.find((item) => item.key === CHECK_NESTED_OR)?.result).toBe('miss')
  })

  it('条件命中 0 行时透视项不通过', () => {
    const items = auditOnTimeLab(snapshot({ pivotRows: [] }))
    expect(items.find((item) => item.key === CHECK_PIVOT)?.result).toBe('miss')
  })

  it('在非最高延误率维度下钻不通过，且不会连带通过导出项', () => {
    const rows = buildPivot(filterFlights(FLIGHT_RECORDS, targetTree()), 'region')
    const worst = topDelayRow(rows)!
    const other = rows.find((row) => row.key !== worst.key)!
    const items = auditOnTimeLab(snapshot({ pivotRows: rows, drilledKey: other.key }))
    expect(items.find((item) => item.key === CHECK_DRILLDOWN)?.result).toBe('miss')
    expect(items.find((item) => item.key === CHECK_EXPORT)?.result).toBe('miss')
  })

  it('从非最高延误率维度导出不通过', () => {
    const rows = buildPivot(filterFlights(FLIGHT_RECORDS, targetTree()), 'region')
    const worst = topDelayRow(rows)!
    const other = rows.find((row) => row.key !== worst.key)!
    const items = auditOnTimeLab(
      snapshot({ pivotRows: rows, drilledKey: worst.key, exportedKey: other.key }),
    )
    expect(items.find((item) => item.key === CHECK_DRILLDOWN)?.result).toBe('ok')
    expect(items.find((item) => item.key === CHECK_EXPORT)?.result).toBe('miss')
  })

  it('完整正确终态全部通过', () => {
    const rows = buildPivot(filterFlights(FLIGHT_RECORDS, targetTree()), 'region')
    const worst = topDelayRow(rows)!
    const items = auditOnTimeLab(
      snapshot({ pivotRows: rows, drilledKey: worst.key, exportedKey: worst.key }),
    )
    expect(items.every((item) => item.result === 'ok')).toBe(true)
  })

  it('findTargetOrGroup 只认带目标分支的 OR 子组', () => {
    expect(findTargetOrGroup(targetTree())).not.toBeNull()
    const plain = clone(INITIAL_TREE)
    plain.children = [orGroup([rule('delayRate', 'gt', 15)])]
    expect(findTargetOrGroup(plain)).toBeNull()
  })
})
