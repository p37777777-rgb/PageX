import { flagMatches, valueMatches } from '../../probe'
import type { InspectionItem } from '../../probe'
import { isRunComplete, REQUIRED_VENDOR_KEY, REQUIRED_VENDOR_VALUE, findVendorConfig } from './engine'
import type { TurnaroundSnapshot } from './types'

/** 判定项 key：CATERER_VENDOR 配置已保存 */
export const VENDOR_CHECK_KEY = 'vendor-config'
/** 判定项 key：流水线 3 组全部完成 */
export const PIPELINE_CHECK_KEY = 'pipeline-complete'
/** 判定项 key：C12 权重 100% 且已应用 */
export const GATE_CHECK_KEY = 'gate-applied'

const GROUP_NAMES = '客舱清洁/航空配餐/加油勤务'

/**
 * 依据页面终态生成判定结果（纯函数）：
 * 1. 资源配置中已保存 CATERER_VENDOR = gateway-catering-group:9120；
 * 2. 保障流水线 3 个分组全部完成；
 * 3. 已应用的登机口放行权重中 C12 为 100%。
 */
export function auditTurnaround(snapshot: TurnaroundSnapshot): InspectionItem[] {
  const vendor = findVendorConfig(snapshot.savedConfigs)
  const vendorValue = vendor?.value.trim() ?? ''
  const vendorItem = flagMatches(
    VENDOR_CHECK_KEY,
    '资源配置已保存 CATERER_VENDOR = gateway-catering-group:9120',
    vendorValue === REQUIRED_VENDOR_VALUE,
    `${REQUIRED_VENDOR_KEY} = ${REQUIRED_VENDOR_VALUE}`,
    vendor === undefined
      ? `${REQUIRED_VENDOR_KEY} 未配置`
      : `${REQUIRED_VENDOR_KEY} = ${vendorValue}`,
  )

  const doneCount = snapshot.runGroups.filter((group) => group.state === 'done').length
  const pipelineItem = flagMatches(
    PIPELINE_CHECK_KEY,
    '保障流水线 3 个分组全部完成',
    isRunComplete(snapshot.runGroups),
    `${GROUP_NAMES} 全部完成`,
    `已完成 ${doneCount}/3`,
  )

  const appliedC12 = snapshot.appliedGateWeights.find((gate) => gate.gate === 'C12')
  const gateItem = valueMatches(
    GATE_CHECK_KEY,
    '登机口放行权重 C12 已应用为 100%',
    100,
    appliedC12?.share ?? '未应用',
  )

  return [vendorItem, pipelineItem, gateItem]
}
