import { describe, expect, it } from 'vitest'
import type { InspectionItem } from '../../probe'
import {
  EXPECTED_LANE_COUNT,
  EXPECTED_ORDER_COUNT,
  REQUIRED_BLOCKER,
  REVIEW_LANE_ID,
  TARGET_ORDER_ID,
  TARGET_ORDER_TITLE,
  TARGET_PRIORITY,
  TARGET_TECHNICIAN,
  advanceOrder,
  countOrders,
  hasBlocker,
  locateOrder,
  moveOrder,
  nextLaneId,
  normalizeInsertIndex,
  visibleOrders,
} from './board'
import {
  BLOCKER_CHECK_KEY,
  BOARD_CHECK_KEY,
  FILTER_CHECK_KEY,
  POSITION_CHECK_KEY,
  TARGET_CHECK_KEY,
  auditMaintenanceBoard,
} from './audit'
import { DEPENDENCY_CANDIDATES, INITIAL_LANES } from './data'
import type { MaintenanceLane, WorkOrder } from './types'

function cloneLanes(): MaintenanceLane[] {
  return JSON.parse(JSON.stringify(INITIAL_LANES)) as MaintenanceLane[]
}

function itemOf(items: InspectionItem[], key: string): InspectionItem {
  const found = items.find((entry) => entry.key === key)
  if (!found) throw new Error(`缺少判定项：${key}`)
  return found
}

describe('看板初始数据', () => {
  it('包含 5 条泳道且共 36 张工单号唯一的工单', () => {
    expect(INITIAL_LANES).toHaveLength(EXPECTED_LANE_COUNT)
    expect(countOrders(INITIAL_LANES)).toBe(EXPECTED_ORDER_COUNT)
    const ids = INITIAL_LANES.flatMap((lane) => lane.orders.map((order) => order.id))
    expect(new Set(ids).size).toBe(EXPECTED_ORDER_COUNT)
  })

  it('目标孔探工单位于施工中泳道，由老周负责且为 P0-特急', () => {
    const located = locateOrder(INITIAL_LANES, TARGET_ORDER_ID)
    expect(located?.laneId).toBe('working')
    expect(located?.order.title).toBe(TARGET_ORDER_TITLE)
    expect(located?.order.technician).toBe(TARGET_TECHNICIAN)
    expect(located?.order.priority).toBe(TARGET_PRIORITY)
  })

  it('候选依赖集中包含 A350 客舱整新工程', () => {
    expect(DEPENDENCY_CANDIDATES).toContain(REQUIRED_BLOCKER)
  })
})

describe('纯函数工具', () => {
  it('normalizeInsertIndex 收敛非法索引', () => {
    expect(normalizeInsertIndex(-5, 3)).toBe(0)
    expect(normalizeInsertIndex(99, 3)).toBe(3)
    expect(normalizeInsertIndex(Number.NaN, 3)).toBe(3)
    expect(normalizeInsertIndex(1.6, 3)).toBe(1)
  })

  it('visibleOrders 按技师与优先级过滤', () => {
    const all = INITIAL_LANES.flatMap((lane) => lane.orders)
    expect(visibleOrders(all, '', '')).toHaveLength(EXPECTED_ORDER_COUNT)
    const byTech = visibleOrders(all, TARGET_TECHNICIAN, '')
    expect(byTech.length).toBeGreaterThan(0)
    expect(byTech.every((order) => order.technician === TARGET_TECHNICIAN)).toBe(true)
    expect(visibleOrders(all, '', 'P0-特急').map((order) => order.id)).toContain(TARGET_ORDER_ID)
    expect(visibleOrders(all, TARGET_TECHNICIAN, 'P3-低')).toHaveLength(0)
  })

  it('hasBlocker 命中关键字', () => {
    const target = INITIAL_LANES.flatMap((lane) => lane.orders)[0]
    const probe: WorkOrder = { ...target, blockers: ['A350 客舱整新工程（一期）'] }
    expect(hasBlocker(probe, REQUIRED_BLOCKER)).toBe(true)
    expect(hasBlocker(probe, '起落架大修返厂批次')).toBe(false)
  })

  it('泳道序列向后推进，已放行为终点', () => {
    expect(nextLaneId('working')).toBe(REVIEW_LANE_ID)
    expect(nextLaneId('released')).toBeNull()
  })
})

describe('moveOrder', () => {
  it('跨泳道移动到列首，并从原泳道移除', () => {
    const before = cloneLanes()
    const lanes = moveOrder(before, TARGET_ORDER_ID, REVIEW_LANE_ID, 0)
    const located = locateOrder(lanes, TARGET_ORDER_ID)
    expect(located?.laneId).toBe(REVIEW_LANE_ID)
    expect(located?.index).toBe(0)
    expect(lanes.find((lane) => lane.id === 'working')?.orders.some((o) => o.id === TARGET_ORDER_ID)).toBe(false)
    expect(countOrders(lanes)).toBe(EXPECTED_ORDER_COUNT)
  })

  it('不修改入参泳道数组', () => {
    const before = cloneLanes()
    moveOrder(before, TARGET_ORDER_ID, REVIEW_LANE_ID, 0)
    expect(locateOrder(before, TARGET_ORDER_ID)?.laneId).toBe('working')
  })

  it('同列内可拖到列首', () => {
    const lanes = cloneLanes()
    const working = lanes.find((lane) => lane.id === 'working')
    const lastOrder = working?.orders[working.orders.length - 1]
    expect(lastOrder).toBeDefined()
    const moved = moveOrder(lanes, lastOrder!.id, 'working', 0)
    expect(locateOrder(moved, lastOrder!.id)?.index).toBe(0)
  })

  it('同列下移时按指示线语义修正索引', () => {
    const lanes = cloneLanes()
    const working = lanes.find((lane) => lane.id === 'working')
    const firstOrder = working?.orders[0]
    expect(firstOrder).toBeDefined()
    const moved = moveOrder(lanes, firstOrder!.id, 'working', working!.orders.length)
    const lane = moved.find((entry) => entry.id === 'working')
    expect(lane?.orders[lane.orders.length - 1].id).toBe(firstOrder!.id)
  })

  it('未知工单号原样返回', () => {
    const lanes = cloneLanes()
    expect(moveOrder(lanes, 'WO-0000', REVIEW_LANE_ID, 0)).toBe(lanes)
  })
})

describe('advanceOrder', () => {
  it('流转到下一泳道并置顶', () => {
    const lanes = advanceOrder(cloneLanes(), TARGET_ORDER_ID)
    const located = locateOrder(lanes, TARGET_ORDER_ID)
    expect(located?.laneId).toBe(REVIEW_LANE_ID)
    expect(located?.index).toBe(0)
  })

  it('已放行工单保持原位', () => {
    const lanes = cloneLanes()
    const released = lanes.find((lane) => lane.id === 'released')
    const firstOrder = released?.orders[0]
    expect(firstOrder).toBeDefined()
    const after = advanceOrder(lanes, firstOrder!.id)
    const located = locateOrder(after, firstOrder!.id)
    expect(located?.laneId).toBe('released')
    expect(located?.index).toBe(0)
  })
})

describe('auditMaintenanceBoard', () => {
  it('初始看板仅看板规模与目标工单两项通过', () => {
    const items = auditMaintenanceBoard({ lanes: cloneLanes(), technicianFilter: '' })
    expect(itemOf(items, BOARD_CHECK_KEY).result).toBe('ok')
    expect(itemOf(items, TARGET_CHECK_KEY).result).toBe('ok')
    expect(itemOf(items, POSITION_CHECK_KEY).result).toBe('miss')
    expect(itemOf(items, BLOCKER_CHECK_KEY).result).toBe('miss')
    expect(itemOf(items, FILTER_CHECK_KEY).result).toBe('miss')
  })

  it('完成指定流程后五项判定全部通过', () => {
    const lanes = advanceOrder(cloneLanes(), TARGET_ORDER_ID)
    const located = locateOrder(lanes, TARGET_ORDER_ID)
    expect(located).not.toBeNull()
    located!.order.blockers.push(REQUIRED_BLOCKER)
    const items = auditMaintenanceBoard({ lanes, technicianFilter: TARGET_TECHNICIAN })
    expect(items.every((entry) => entry.result === 'ok')).toBe(true)
  })

  it('工单在待复核但不在列首时位置判定不通过', () => {
    const lanes = moveOrder(cloneLanes(), TARGET_ORDER_ID, REVIEW_LANE_ID, 2)
    const items = auditMaintenanceBoard({ lanes, technicianFilter: TARGET_TECHNICIAN })
    expect(itemOf(items, POSITION_CHECK_KEY).result).toBe('miss')
    expect(itemOf(items, POSITION_CHECK_KEY).got).toBe('review[2]')
  })

  it('仅添加无关依赖时依赖判定不通过', () => {
    const lanes = cloneLanes()
    const located = locateOrder(lanes, TARGET_ORDER_ID)
    expect(located).not.toBeNull()
    located!.order.blockers.push('货舱消防系统升级')
    const items = auditMaintenanceBoard({ lanes, technicianFilter: '' })
    expect(itemOf(items, BLOCKER_CHECK_KEY).result).toBe('miss')
  })

  it('移入其他泳道时位置判定不通过', () => {
    const lanes = advanceOrder(advanceOrder(cloneLanes(), TARGET_ORDER_ID), TARGET_ORDER_ID)
    const items = auditMaintenanceBoard({ lanes, technicianFilter: '' })
    expect(locateOrder(lanes, TARGET_ORDER_ID)?.laneId).toBe('released')
    expect(itemOf(items, POSITION_CHECK_KEY).result).toBe('miss')
  })

  it('技师筛选非老周时筛选判定不通过', () => {
    const items = auditMaintenanceBoard({ lanes: cloneLanes(), technicianFilter: '马奋' })
    expect(itemOf(items, FILTER_CHECK_KEY).result).toBe('miss')
  })
})
