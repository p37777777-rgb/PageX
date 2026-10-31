/** 停机坪区 */
export type ApronZone = 'A' | 'B' | 'C'

/** 航班过站状态 */
export type FlightState = 'arrived' | 'servicing' | 'hold' | 'ready' | 'departed'

/** SOP 版本 */
export type SopVersion = 'v2' | 'v3'

/** 保障分组 */
export type GroupId = 'cabin' | 'catering' | 'fuel'

/** 单个保障节点/分组的运行状态 */
export type NodeRunState = 'pending' | 'running' | 'done' | 'failed' | 'blocked'

/** 过站航班 */
export interface TurnaroundFlight {
  id: string
  flightNo: string
  /** 机位，如 A-12 */
  stand: string
  zone: ApronZone
  /** 注册号 */
  registration: string
  /** 计划离港时刻 HH:mm */
  etd: string
  state: FlightState
  /** 当前保障节点 */
  currentNode: string
  /** 下一动作 */
  nextAction: string
}

/** SOP 步骤定义 */
export interface SopStep {
  id: string
  label: string
  doneMessage: string
}

/** SOP 分组定义 */
export interface SopGroupPlan {
  id: GroupId
  name: string
  crew: string
  steps: SopStep[]
}

/** 流水线中一个分组的运行态 */
export interface RunGroupState {
  id: GroupId
  state: NodeRunState
  /** 已完成的步骤数 */
  stepIndex: number
  /** 失败时定位到具体步骤 */
  failedStepId?: string
}

/** 节点日志 */
export interface RunLogEntry {
  seq: number
  time: string
  groupId: GroupId
  level: 'info' | 'warn' | 'fatal'
  step: string
  message: string
}

/** 流水线推进事件（由纯函数生成，组件按事件回放状态变化） */
export interface RunEvent {
  groupId: GroupId
  kind: 'group-start' | 'step' | 'group-done' | 'fatal'
  stepId: string
  state: NodeRunState
  log: RunLogEntry
}

/** 保障服务配置项 */
export interface ServiceConfigItem {
  key: string
  value: string
  remark: string
}

/** 登机口放行权重 */
export interface GateWeightItem {
  gate: string
  share: number
}

/** 判定快照：只读页面终态所需的最小字段 */
export interface TurnaroundSnapshot {
  savedConfigs: ServiceConfigItem[]
  runGroups: RunGroupState[]
  appliedGateWeights: GateWeightItem[]
}
