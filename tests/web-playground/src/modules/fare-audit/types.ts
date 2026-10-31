/*
 * 票款稽核 · 领域类型
 * 主页面（直销出票记录）与子页（渠道结算流水台）共用同一套数据与类型。
 */

/** 单据在核销流程中的结算状态 */
export type SettleState = '待核销' | '核销通过' | '金额差异' | '流水缺失'

/** 依据流水推导出的标准处置口径 */
export type Disposition = 'matched' | 'discrepancy' | 'missing'

/** 渠道流水到账状态 */
export type ArrivalStatus = '已到账' | '在途' | '挂账'

/** 直销出票记录（只读档案字段） */
export interface TicketOrder {
  tktNo: string
  pnr: string
  route: string
  passenger: string
  issuedAmount: number
}

/** 渠道结算流水（子页展示，主页面据此判定口径） */
export interface LedgerEntry {
  ledgerNo: string
  tktNo: string
  tradedAt: string
  settleAmount: number
  channelFee: number
  arrival: ArrivalStatus
}

/** 单张客票的核销登记（可变状态） */
export interface AuditRecord {
  state: SettleState
  /** 标记差异时录入的渠道实结金额 */
  actualAmount: number | null
  /** 标记差异时录入的差异原因 */
  reason: string
}
