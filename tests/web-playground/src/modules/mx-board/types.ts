export type Priority = 'P0-特急' | 'P1-紧急' | 'P2-常规' | 'P3-低'

export type LaneId = 'assess' | 'prepare' | 'working' | 'review' | 'released'

/** 机务维修工单 */
export interface WorkOrder {
  id: string
  title: string
  /** 机型 / 注册号，如 A350-900 / B-1083 */
  aircraft: string
  technician: string
  priority: Priority
  /** 额定工时 */
  manHours: number
  subtasksDone: number
  subtasksTotal: number
  /** 阻塞依赖（前置工程） */
  blockers: string[]
}

export interface MaintenanceLane {
  id: LaneId
  title: string
  orders: WorkOrder[]
}

/** 供判定纯函数读取的看板终态快照 */
export interface BoardSnapshot {
  lanes: MaintenanceLane[]
  technicianFilter: string
}

export interface OrderLocation {
  laneId: LaneId
  laneTitle: string
  index: number
  order: WorkOrder
}
