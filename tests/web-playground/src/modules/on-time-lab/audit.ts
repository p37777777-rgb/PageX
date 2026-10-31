import { flagMatches } from '../../probe'
import type { InspectionItem } from '../../probe'
import { collectGroups, topDelayRow } from './engine'
import type { FilterGroup, FilterRule, OnTimeLabSnapshot } from './types'

/** 判定项 key：根组 AND 且含目标基础条件 */
export const CHECK_ROOT = 'condition-root'
/** 判定项 key：存在含目标分支的 OR 嵌套子组 */
export const CHECK_NESTED_OR = 'condition-nested-or'
/** 判定项 key：透视矩阵已计算且非空 */
export const CHECK_PIVOT = 'pivot-matrix'
/** 判定项 key：已在平均延误率最高的维度行展开明细 */
export const CHECK_DRILLDOWN = 'worst-row-drilldown'
/** 判定项 key：已导出该维度的问题航班明细报表 */
export const CHECK_EXPORT = 'detail-export'

function ruleEquals(
  rule: FilterRule,
  field: FilterRule['field'],
  operator: FilterRule['operator'],
  value: string | number,
): boolean {
  if (rule.field !== field || rule.operator !== operator) return false
  if (typeof value === 'number') return Number(rule.value) === value
  return String(rule.value) === value
}

function groupHasDirectRule(
  group: FilterGroup,
  field: FilterRule['field'],
  operator: FilterRule['operator'],
  value: string | number,
): boolean {
  return group.children.some(
    (child) => child.kind === 'rule' && ruleEquals(child, field, operator, value),
  )
}

/**
 * 目标 OR 子组：组合关系为 OR，且同时包含
 * 「延误率 > 15」与「旅客投诉 >= 3」两个分支条件。
 */
export function findTargetOrGroup(root: FilterGroup): FilterGroup | null {
  return (
    collectGroups(root).find(
      (group) =>
        group.id !== root.id &&
        group.logic === 'OR' &&
        groupHasDirectRule(group, 'delayRate', 'gt', 15) &&
        groupHasDirectRule(group, 'complaints', 'gte', 3),
    ) ?? null
  )
}

/**
 * 依据页面终态生成判定结果（纯函数），对齐任务简报 steps：
 * 1. 根组保持 AND，含「出港时段 = 早高峰」与「平均载客率 > 70」；
 * 2. 存在 OR 嵌套子组，含「延误率 > 15」或「旅客投诉 >= 3」分支；
 * 3. 已执行透视计算且矩阵非空；
 * 4. 已在平均延误率最高的维度行展开明细抽屉；
 * 5. 已从该维度导出明细报表。
 */
export function auditOnTimeLab(snapshot: OnTimeLabSnapshot): InspectionItem[] {
  const { root, pivotRows, drilledKey, exportedKey } = snapshot
  const rows = pivotRows ?? []
  const worst = topDelayRow(rows)

  const rootOk =
    root.logic === 'AND' &&
    groupHasDirectRule(root, 'departureSlot', 'eq', '早高峰') &&
    groupHasDirectRule(root, 'loadFactor', 'gt', 70)
  const rootItem = flagMatches(
    CHECK_ROOT,
    '顶层条件组为 AND，含「出港时段 = 早高峰」与「平均载客率 > 70」',
    rootOk,
    'AND + 出港时段=早高峰 + 平均载客率>70',
    `${root.logic} / ${root.children.length} 个子条件`,
  )

  const nestedItem = flagMatches(
    CHECK_NESTED_OR,
    '存在 OR 嵌套子组，含「延误率 > 15」与「旅客投诉 ≥ 3」两个分支',
    findTargetOrGroup(root) != null,
    'OR 子组含 延误率>15 与 旅客投诉>=3',
    findTargetOrGroup(root) != null ? '已匹配' : '未找到目标子组',
  )

  const pivotItem = flagMatches(
    CHECK_PIVOT,
    '已执行透视计算且维度矩阵非空',
    rows.length > 0,
    '矩阵至少 1 行',
    rows.length === 0 ? (pivotRows == null ? '未计算' : '命中 0 行') : `${rows.length} 行`,
  )

  const drilldownItem = flagMatches(
    CHECK_DRILLDOWN,
    '已在平均延误率最高的维度行展开明细',
    Boolean(worst && drilledKey === worst.key),
    worst?.key ?? '需先完成透视',
    drilledKey ?? '未下钻',
  )

  const exportItem = flagMatches(
    CHECK_EXPORT,
    '已导出延误率最高维度的问题航班明细报表',
    Boolean(worst && exportedKey != null && exportedKey === worst.key),
    worst?.key ?? '需先完成透视',
    exportedKey ?? '未导出',
  )

  return [rootItem, nestedItem, pivotItem, drilldownItem, exportItem]
}
