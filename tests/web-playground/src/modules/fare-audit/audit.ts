/*
 * 票款稽核 · 体检判定
 * 对齐 registry.steps：
 *  1. 查阅直销出票记录（48 笔，每页 6 笔）；
 *  2. 在新标签页打开渠道流水台；
 *  3. 第 1 页逐笔处置（核销通过 / 金额差异 / 流水缺失）；
 *  4. 提交当页核销结果。
 * 全部逻辑为纯函数，便于 vitest 覆盖正反用例。
 */
import type { InspectionItem } from '../../probe'
import { flagMatches } from '../../probe'
import { EXPECTED_TOTAL, PAGE_SIZE } from './data'
import type { AuditRecord, Disposition, LedgerEntry, SettleState, TicketOrder } from './types'

/** 处置口径 → 结算状态映射 */
export const DISPOSITION_STATE: Record<Disposition, SettleState> = {
  matched: '核销通过',
  discrepancy: '金额差异',
  missing: '流水缺失',
}

/** 判定项稳定 key，与 registry.steps 一一对应 */
export const CHECK_KEYS = [
  'tickets-listed',
  'ledger-window-opened',
  'page1-matched',
  'page1-discrepancy',
  'page1-missing',
  'page1-submitted',
] as const

export interface Page1Expectation {
  tktNo: string
  disposition: Disposition
  /** 标记差异时应录入的渠道实结金额（来自流水结算金额） */
  settleAmount: number | null
  /** 是否要求差异原因非空 */
  reasonRequired: boolean
}

export interface AuditSnapshot {
  orders: TicketOrder[]
  /** 票号 → 当前核销登记 */
  audits: Record<string, AuditRecord>
  ledgers: LedgerEntry[]
  pageSize: number
  page1Submitted: boolean
  ledgerWindowOpened: boolean
}

function cents(value: number | null | undefined): number {
  return value == null ? Number.NaN : Math.round(value * 100)
}

function ledgerIndex(ledgers: LedgerEntry[]): Map<string, LedgerEntry> {
  const index = new Map<string, LedgerEntry>()
  for (const entry of ledgers) {
    if (!index.has(entry.tktNo)) index.set(entry.tktNo, entry)
  }
  return index
}

/** 依据流水推导单张客票的标准处置口径 */
export function expectedDisposition(
  order: TicketOrder,
  ledgerByTkt: Map<string, LedgerEntry>,
): Disposition {
  const entry = ledgerByTkt.get(order.tktNo)
  if (!entry) return 'missing'
  return cents(entry.settleAmount) === cents(order.issuedAmount) ? 'matched' : 'discrepancy'
}

/** 推导第 1 页各单据的期望处置计划 */
export function page1Expectations(
  orders: TicketOrder[],
  ledgers: LedgerEntry[],
  pageSize: number = PAGE_SIZE,
): Page1Expectation[] {
  const byTkt = ledgerIndex(ledgers)
  return orders.slice(0, pageSize).map((order) => {
    const disposition = expectedDisposition(order, byTkt)
    return {
      tktNo: order.tktNo,
      disposition,
      settleAmount: disposition === 'discrepancy' ? (byTkt.get(order.tktNo)?.settleAmount ?? null) : null,
      reasonRequired: disposition === 'discrepancy',
    }
  })
}

export function runAudit(snapshot: AuditSnapshot): InspectionItem[] {
  const { orders, audits, ledgers, pageSize, page1Submitted, ledgerWindowOpened } = snapshot
  const page1 = orders.slice(0, pageSize)
  const expectations = page1Expectations(orders, ledgers, pageSize)

  const matchedPlans = expectations.filter((item) => item.disposition === 'matched')
  const matchedStates = matchedPlans.map(
    (item) => `${item.tktNo}:${audits[item.tktNo]?.state ?? '未处置'}`,
  )
  const matchedOk = matchedPlans.every(
    (item) => audits[item.tktNo]?.state === DISPOSITION_STATE.matched,
  )

  const discrepancyPlan = expectations.find((item) => item.disposition === 'discrepancy')
  const discrepancyRecord = discrepancyPlan ? audits[discrepancyPlan.tktNo] : undefined
  const discrepancyOk =
    discrepancyPlan != null &&
    discrepancyRecord?.state === DISPOSITION_STATE.discrepancy &&
    cents(discrepancyRecord.actualAmount) === cents(discrepancyPlan.settleAmount) &&
    discrepancyRecord.reason.trim().length > 0
  const discrepancyGot = discrepancyRecord
    ? `${discrepancyRecord.state} / 实结 ${discrepancyRecord.actualAmount ?? '未填'} / 原因${
        discrepancyRecord.reason.trim() ? '已填写' : '未填写'
      }`
    : '未处置'

  const missingPlan = expectations.find((item) => item.disposition === 'missing')
  const missingState = missingPlan ? (audits[missingPlan.tktNo]?.state ?? '未处置') : '未处置'

  return [
    flagMatches(
      'tickets-listed',
      '直销出票记录已按每页 6 笔分页加载（全量 48 笔）',
      orders.length === EXPECTED_TOTAL && pageSize === PAGE_SIZE && page1.length === PAGE_SIZE,
      '全量 48 笔、每页 6 笔',
      `全量 ${orders.length} 笔、每页 ${pageSize} 笔`,
    ),
    flagMatches(
      'ledger-window-opened',
      '已通过工具栏在新标签页打开渠道结算流水台',
      ledgerWindowOpened,
      '打开渠道流水台标签页',
      ledgerWindowOpened ? '已打开' : '未打开',
    ),
    flagMatches(
      'page1-matched',
      `第 1 页 ${matchedPlans.length} 笔金额吻合单据已全部「核销通过」`,
      matchedOk,
      matchedPlans.map((item) => `${item.tktNo} 核销通过`).join('、'),
      matchedStates.join('、') || '无吻合单据',
    ),
    flagMatches(
      'page1-discrepancy',
      `${discrepancyPlan?.tktNo ?? '差异单据'} 已标记「金额差异」，实结金额与差异原因填写完整`,
      discrepancyOk,
      discrepancyPlan
        ? `${discrepancyPlan.tktNo} 金额差异 / 实结 ${discrepancyPlan.settleAmount} / 原因非空`
        : '第 1 页应含差异单据',
      discrepancyGot,
    ),
    flagMatches(
      'page1-missing',
      `${missingPlan?.tktNo ?? '缺失单据'} 已标记「流水缺失」`,
      missingPlan != null && missingState === DISPOSITION_STATE.missing,
      missingPlan ? `${missingPlan.tktNo} 流水缺失` : '第 1 页应含缺失单据',
      missingState,
    ),
    flagMatches(
      'page1-submitted',
      '第 1 页 6 笔全部处置后已点击「提交当页核销结果」',
      page1Submitted,
      '已提交当页核销结果',
      page1Submitted ? '已提交' : '未提交',
    ),
  ]
}
