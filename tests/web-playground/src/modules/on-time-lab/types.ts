/*
 * 准点实验 · 类型定义
 * 业务语境：航班准点多维分析（条件树 → 透视矩阵 → 明细下钻）。
 */
import type { InjectionKey } from 'vue'

/** 航线区域（主营维度） */
export type RegionName = '华东' | '华南' | '西南' | '华北' | '东北' | '西北'

/** 出港时段 */
export type SlotName = '早高峰' | '平峰' | '晚高峰'

/** 航班执行明细（单条 = 一个航班的运行切片） */
export interface FlightRecord {
  flightNo: string
  departureSlot: SlotName
  region: RegionName
  /** 平均载客率 % */
  loadFactor: number
  /** 延误率 % */
  delayRate: number
  /** 旅客投诉（次） */
  complaints: number
}

/** 条件树可引用的筛选字段 */
export type FilterField =
  | 'departureSlot'
  | 'region'
  | 'loadFactor'
  | 'delayRate'
  | 'complaints'

/** 组内组合关系 */
export type LogicOperator = 'AND' | 'OR'

/** 比较操作符 */
export type CompareOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'

/** 基础条件（叶子节点） */
export interface FilterRule {
  kind: 'rule'
  id: string
  field: FilterField
  operator: CompareOperator
  value: string | number
}

/** 条件组（可无限嵌套） */
export interface FilterGroup {
  kind: 'group'
  id: string
  logic: LogicOperator
  children: FilterNode[]
}

export type FilterNode = FilterRule | FilterGroup

/** 透视维度 */
export type PivotDimension = 'region' | 'departureSlot'

/** 透视矩阵的一行 */
export interface PivotRow {
  /** 维度取值（如「西北」或「早高峰」） */
  key: string
  dimension: PivotDimension
  flightCount: number
  avgDelayRate: number
  avgLoadFactor: number
  totalComplaints: number
  /** 该维度命中的航班明细（供下钻抽屉与导出使用） */
  records: FlightRecord[]
}

/** 体检探针读取的页面终态快照 */
export interface OnTimeLabSnapshot {
  root: FilterGroup
  pivotRows: PivotRow[] | null
  /** 已在哪个维度取值上展开过明细抽屉 */
  drilledKey: string | null
  /** 已从哪个维度取值上导出过明细报表 */
  exportedKey: string | null
}

/** 条件树构建器的增删操作（由视图层 provide，递归子组件 inject） */
export interface TreeOps {
  addRule(groupId: string): void
  addSubgroup(groupId: string): void
  removeNode(nodeId: string): void
}

/** TreeOps 的 provide/inject 键 */
export const TREE_OPS_KEY: InjectionKey<TreeOps> = Symbol('on-time-lab-tree-ops')
