/*
 * 行李理赔判定逻辑（纯函数）：
 * 输入页面终态快照，输出 InspectionItem[]。
 * 判定 key 与 registry 中 baggage-claims 模块的 steps 对齐：
 * 1. 营销遮罩已关闭            -> overlay-closed
 * 2. 赔付方案 = 折旧赔付        -> award-plan
 * 3. 赔付金额 = 1580 元         -> award-amount
 * 4. 核验依据非空              -> verify-basis
 * 5. 已提交裁决                -> verdict-submitted
 */
import type { InspectionItem } from '../../probe/types'
import { flagMatches, valueMatches } from '../../probe/items'
import type { ClaimSnapshot } from './state'
import { DEPRECIATION_PAYOUT } from './data'
import type { AwardPlan } from './types'

/** 赔付方案的可读名称 */
export const PLAN_LABELS: Record<AwardPlan, string> = {
  '': '未选择',
  full: '全额赔付',
  depreciation: '折旧赔付',
  reject: '拒绝赔付',
}

/** 金额取整比较：容忍 1580.00 与 1580 的等值 */
export function isPayoutMatched(amount: number | null): boolean {
  return amount !== null && Math.round(amount) === DEPRECIATION_PAYOUT
}

export function auditBaggageClaims(s: ClaimSnapshot): InspectionItem[] {
  return [
    flagMatches(
      'overlay-closed',
      '会员权益调研遮罩已关闭',
      !s.overlayOpen,
      '遮罩已关闭',
      s.overlayOpen ? '遮罩仍打开' : '已关闭',
    ),
    valueMatches('award-plan', '赔付方案选择「折旧赔付」', '折旧赔付', PLAN_LABELS[s.plan] ?? '未选择'),
    valueMatches(
      'award-amount',
      '赔付金额为 1580 元',
      DEPRECIATION_PAYOUT,
      s.amount === null ? '未填写' : isPayoutMatched(s.amount) ? DEPRECIATION_PAYOUT : s.amount,
    ),
    flagMatches(
      'verify-basis',
      '核验依据非空',
      s.basis.trim().length > 0,
      '已填写核验依据',
      s.basis.trim() ? `已填写 ${s.basis.trim().length} 字` : '未填写',
    ),
    flagMatches(
      'verdict-submitted',
      '已提交最终裁决',
      s.submitted,
      '已提交裁决',
      s.submitted ? '已提交' : '未提交',
    ),
  ]
}
