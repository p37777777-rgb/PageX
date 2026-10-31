import { REGION_VALUES, SLOT_VALUES } from './data'
import type {
  CompareOperator,
  FilterField,
  FilterGroup,
  FilterNode,
  FilterRule,
  FlightRecord,
  PivotDimension,
  PivotRow,
} from './types'

/* ---------- 字段元数据 ---------- */

export interface FieldMeta {
  field: FilterField
  label: string
  kind: 'text' | 'number'
  /** 文本字段的可选取值；数字字段为空 */
  options?: readonly string[]
  /** 数字字段的输入精度 */
  precision?: number
}

export const FILTER_FIELDS: readonly FieldMeta[] = [
  { field: 'departureSlot', label: '出港时段', kind: 'text', options: SLOT_VALUES },
  { field: 'region', label: '航线区域', kind: 'text', options: REGION_VALUES },
  { field: 'loadFactor', label: '平均载客率(%)', kind: 'number', precision: 1 },
  { field: 'delayRate', label: '延误率(%)', kind: 'number', precision: 1 },
  { field: 'complaints', label: '旅客投诉(次)', kind: 'number', precision: 0 },
]

const FIELD_META_MAP: Record<FilterField, FieldMeta> = Object.fromEntries(
  FILTER_FIELDS.map((meta) => [meta.field, meta]),
) as Record<FilterField, FieldMeta>

export function fieldMeta(field: FilterField): FieldMeta {
  return FIELD_META_MAP[field]
}

export const OPERATOR_LABELS: Record<CompareOperator, string> = {
  eq: '等于',
  neq: '不等于',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
}

/** 文本字段只开放相等性比较，数字字段开放全部比较符 */
export function operatorsForField(field: FilterField): CompareOperator[] {
  return FIELD_META_MAP[field].kind === 'text'
    ? ['eq', 'neq']
    : ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']
}

/* ---------- 节点工厂 ---------- */

let nodeSeed = 0

export function createRule(field: FilterField = 'departureSlot'): FilterRule {
  nodeSeed += 1
  const meta = FIELD_META_MAP[field]
  return {
    kind: 'rule',
    id: `otl-rule-${nodeSeed}`,
    field,
    operator: operatorsForField(field)[0],
    value: meta.options ? meta.options[0] : 0,
  }
}

export function createGroup(): FilterGroup {
  nodeSeed += 1
  return { kind: 'group', id: `otl-group-${nodeSeed}`, logic: 'AND', children: [] }
}

/* ---------- 条件树求值（纯函数） ---------- */

function slotOf(record: FlightRecord): string {
  return record.departureSlot
}

function regionOf(record: FlightRecord): string {
  return record.region
}

function numberOf(record: FlightRecord, field: FilterField): number {
  if (field === 'loadFactor') return record.loadFactor
  if (field === 'delayRate') return record.delayRate
  return record.complaints
}

export function matchesRule(rule: FilterRule, record: FlightRecord): boolean {
  const meta = FIELD_META_MAP[rule.field]
  if (meta.kind === 'text') {
    const target = String(rule.value)
    const actual = rule.field === 'departureSlot' ? slotOf(record) : regionOf(record)
    if (rule.operator === 'eq') return actual === target
    if (rule.operator === 'neq') return actual !== target
    return false
  }
  const target = Number(rule.value)
  if (!Number.isFinite(target)) return false
  const actual = numberOf(record, rule.field)
  switch (rule.operator) {
    case 'eq':
      return actual === target
    case 'neq':
      return actual !== target
    case 'gt':
      return actual > target
    case 'gte':
      return actual >= target
    case 'lt':
      return actual < target
    case 'lte':
      return actual <= target
    default:
      return false
  }
}

/** 空条件组视为恒真（不缩小结果集） */
export function matchesGroup(group: FilterGroup, record: FlightRecord): boolean {
  if (group.children.length === 0) return true
  const hit = (child: FilterNode): boolean =>
    child.kind === 'rule' ? matchesRule(child, record) : matchesGroup(child, record)
  return group.logic === 'AND'
    ? group.children.every(hit)
    : group.children.some(hit)
}

export function filterFlights(
  records: readonly FlightRecord[],
  root: FilterGroup,
): FlightRecord[] {
  return records.filter((record) => matchesGroup(root, record))
}

/* ---------- 树结构操作 ---------- */

export function collectGroups(root: FilterGroup): FilterGroup[] {
  const groups = [root]
  for (const child of root.children) {
    if (child.kind === 'group') groups.push(...collectGroups(child))
  }
  return groups
}

export function findGroup(root: FilterGroup, groupId: string): FilterGroup | null {
  return collectGroups(root).find((group) => group.id === groupId) ?? null
}

/** 向指定组追加子节点；目标组不存在时返回 false */
export function insertIntoGroup(
  root: FilterGroup,
  groupId: string,
  node: FilterNode,
): boolean {
  const group = findGroup(root, groupId)
  if (group == null) return false
  group.children.push(node)
  return true
}

/** 按 id 移除任意节点（含嵌套子组）；根组不可移除 */
export function removeNode(root: FilterGroup, nodeId: string): boolean {
  if (root.id === nodeId) return false
  const index = root.children.findIndex((child) => child.id === nodeId)
  if (index >= 0) {
    root.children.splice(index, 1)
    return true
  }
  return root.children.some((child) => child.kind === 'group' && removeNode(child, nodeId))
}

/* ---------- 透视聚合（纯函数） ---------- */

const round1 = (value: number): number => Math.round(value * 10) / 10

export function dimensionValue(record: FlightRecord, dimension: PivotDimension): string {
  return dimension === 'region' ? record.region : record.departureSlot
}

export function buildPivot(
  records: readonly FlightRecord[],
  dimension: PivotDimension,
): PivotRow[] {
  const buckets = new Map<string, FlightRecord[]>()
  for (const record of records) {
    const key = dimensionValue(record, dimension)
    const bucket = buckets.get(key)
    if (bucket == null) buckets.set(key, [record])
    else bucket.push(record)
  }
  return Array.from(buckets.entries())
    .map(([key, list]) => ({
      key,
      dimension,
      flightCount: list.length,
      avgDelayRate: round1(list.reduce((sum, r) => sum + r.delayRate, 0) / list.length),
      avgLoadFactor: round1(list.reduce((sum, r) => sum + r.loadFactor, 0) / list.length),
      totalComplaints: list.reduce((sum, r) => sum + r.complaints, 0),
      records: list,
    }))
    .sort((a, b) => b.flightCount - a.flightCount || a.key.localeCompare(b.key))
}

/** 平均延误率最高的维度行（并列时取航班数更多者） */
export function topDelayRow(rows: readonly PivotRow[]): PivotRow | null {
  if (rows.length === 0) return null
  return rows.reduce((worst, row) =>
    row.avgDelayRate > worst.avgDelayRate ||
    (row.avgDelayRate === worst.avgDelayRate && row.flightCount > worst.flightCount)
      ? row
      : worst,
  )
}

/* ---------- 报表导出 ---------- */

export function buildDetailCsv(records: readonly FlightRecord[]): string {
  const header = '航班号,出港时段,航线区域,平均载客率(%),延误率(%),旅客投诉(次)'
  const lines = records.map((record) =>
    [
      record.flightNo,
      record.departureSlot,
      record.region,
      record.loadFactor,
      record.delayRate,
      record.complaints,
    ].join(','),
  )
  return [header, ...lines].join('\r\n')
}
