import { flagMatches } from '../../probe'
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
  countOrders,
  hasBlocker,
  locateOrder,
} from './board'
import type { BoardSnapshot } from './types'

/** 判定项 key：看板 5 条泳道 / 36 张工单 */
export const BOARD_CHECK_KEY = 'board-overview'
/** 判定项 key：目标工单存在且归属老周、P0-特急 */
export const TARGET_CHECK_KEY = 'target-order'
/** 判定项 key：目标工单已位于待复核列首 */
export const POSITION_CHECK_KEY = 'review-top'
/** 判定项 key：阻塞依赖包含 A350 客舱整新工程 */
export const BLOCKER_CHECK_KEY = 'cabin-refit-blocker'
/** 判定项 key：技师筛选为老周 */
export const FILTER_CHECK_KEY = 'tech-filter'

/**
 * 依据看板终态生成判定结果（纯函数），对齐模块验收步骤：
 * 1. 看板完整呈现 5 条泳道与 36 张维修工单；
 * 2. 目标工单「发动机孔探检查」存在，由老周负责且优先级 P0-特急；
 * 3. 该工单已移至「待复核」列最上方；
 * 4. 其阻塞依赖包含「A350 客舱整新工程」；
 * 5. 顶部技师筛选为「老周」。
 */
export function auditMaintenanceBoard(snapshot: BoardSnapshot): InspectionItem[] {
  const lanes = snapshot.lanes

  const boardOk = lanes.length === EXPECTED_LANE_COUNT && countOrders(lanes) === EXPECTED_ORDER_COUNT
  const boardItem = flagMatches(
    BOARD_CHECK_KEY,
    '看板横向呈现 5 条泳道且共 36 张维修工单',
    boardOk,
    `${EXPECTED_LANE_COUNT} 条泳道 / ${EXPECTED_ORDER_COUNT} 张工单`,
    `${lanes.length} 条泳道 / ${countOrders(lanes)} 张工单`,
  )

  const located = locateOrder(lanes, TARGET_ORDER_ID)
  const targetOk =
    located !== null &&
    located.order.title === TARGET_ORDER_TITLE &&
    located.order.technician === TARGET_TECHNICIAN &&
    located.order.priority === TARGET_PRIORITY
  const targetItem = flagMatches(
    TARGET_CHECK_KEY,
    '「发动机孔探检查」工单存在且由老周负责、优先级 P0-特急',
    targetOk,
    `${TARGET_TECHNICIAN} · ${TARGET_PRIORITY}`,
    located
      ? `${located.laneTitle} · ${located.order.technician} · ${located.order.priority}`
      : '未找到工单',
  )

  const positionOk = located !== null && located.laneId === REVIEW_LANE_ID && located.index === 0
  const positionItem = flagMatches(
    POSITION_CHECK_KEY,
    '「发动机孔探检查」已移至「待复核」列最上方',
    positionOk,
    'review[0]（待复核列首位）',
    located ? `${located.laneId}[${located.index}]` : '未找到工单',
  )

  const blockerOk = located !== null && hasBlocker(located.order, REQUIRED_BLOCKER)
  const blockerItem = flagMatches(
    BLOCKER_CHECK_KEY,
    '阻塞依赖包含「A350 客舱整新工程」',
    blockerOk,
    REQUIRED_BLOCKER,
    located ? located.order.blockers.join('、') || '无' : '未找到工单',
  )

  const filterOk = snapshot.technicianFilter === TARGET_TECHNICIAN
  const filterItem = flagMatches(
    FILTER_CHECK_KEY,
    '顶部技师筛选为「老周」',
    filterOk,
    TARGET_TECHNICIAN,
    snapshot.technicianFilter || '未筛选',
  )

  return [boardItem, targetItem, positionItem, blockerItem, filterItem]
}
