import type { LaneId, MaintenanceLane, OrderLocation, WorkOrder } from './types'

/** 目标工单：施工中 · 老周 · P0-特急 · 发动机孔探检查 */
export const TARGET_ORDER_ID = 'WO-6061'
export const TARGET_ORDER_TITLE = '发动机孔探检查'
export const TARGET_TECHNICIAN = '老周'
export const TARGET_PRIORITY = 'P0-特急'

/** 判定要求的前置依赖工程 */
export const REQUIRED_BLOCKER = 'A350 客舱整新工程'

export const REVIEW_LANE_ID: LaneId = 'review'
export const EXPECTED_LANE_COUNT = 5
export const EXPECTED_ORDER_COUNT = 36

const LANE_SEQUENCE: LaneId[] = ['assess', 'prepare', 'working', 'review', 'released']

export function locateOrder(lanes: MaintenanceLane[], orderId: string): OrderLocation | null {
  for (const lane of lanes) {
    const index = lane.orders.findIndex((candidate) => candidate.id === orderId)
    if (index >= 0) {
      return { laneId: lane.id, laneTitle: lane.title, index, order: lane.orders[index] }
    }
  }
  return null
}

export function countOrders(lanes: MaintenanceLane[]): number {
  return lanes.reduce((sum, lane) => sum + lane.orders.length, 0)
}

export function nextLaneId(laneId: LaneId): LaneId | null {
  const at = LANE_SEQUENCE.indexOf(laneId)
  if (at < 0 || at === LANE_SEQUENCE.length - 1) return null
  return LANE_SEQUENCE[at + 1]
}

/** 把任意落点索引收敛到 [0, length] 区间 */
export function normalizeInsertIndex(rawIndex: number, length: number): number {
  if (!Number.isFinite(rawIndex)) return length
  return Math.min(Math.max(Math.trunc(rawIndex), 0), length)
}

/**
 * 把工单移动到目标泳道的指定插入位（0 表示列首，length 表示列尾）。
 * targetIndex 按“拖拽指示线”语义计量：同列下移时扣除自身腾出的位置。
 * 返回全新数组，不修改入参。
 */
export function moveOrder(
  lanes: MaintenanceLane[],
  orderId: string,
  targetLaneId: LaneId,
  targetIndex: number,
): MaintenanceLane[] {
  const located = locateOrder(lanes, orderId)
  const targetLane = lanes.find((lane) => lane.id === targetLaneId)
  if (!located || !targetLane) return lanes

  const sameLane = located.laneId === targetLaneId
  let insertAt = normalizeInsertIndex(targetIndex, targetLane.orders.length)
  if (sameLane && located.index < insertAt) insertAt -= 1

  return lanes.map((lane) => {
    if (sameLane && lane.id === located.laneId) {
      const orders = lane.orders.filter((candidate) => candidate.id !== orderId)
      orders.splice(insertAt, 0, located.order)
      return { ...lane, orders }
    }
    if (lane.id === located.laneId) {
      return { ...lane, orders: lane.orders.filter((candidate) => candidate.id !== orderId) }
    }
    if (lane.id === targetLaneId) {
      const orders = lane.orders.slice()
      orders.splice(insertAt, 0, located.order)
      return { ...lane, orders }
    }
    return lane
  })
}

/** 流转到下一泳道并置顶；已放行工单原地不动 */
export function advanceOrder(lanes: MaintenanceLane[], orderId: string): MaintenanceLane[] {
  const located = locateOrder(lanes, orderId)
  if (!located) return lanes
  const next = nextLaneId(located.laneId)
  if (!next) return lanes
  return moveOrder(lanes, orderId, next, 0)
}

export function hasBlocker(target: WorkOrder, keyword: string): boolean {
  return target.blockers.some((item) => item.includes(keyword))
}

export function visibleOrders(
  orders: WorkOrder[],
  technicianFilter: string,
  priorityFilter: string,
): WorkOrder[] {
  return orders.filter(
    (candidate) =>
      (!technicianFilter || candidate.technician === technicianFilter) &&
      (!priorityFilter || candidate.priority === priorityFilter),
  )
}
