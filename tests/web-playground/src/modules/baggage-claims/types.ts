/*
 * 行李理赔模块类型定义。
 * 与旧场景无任何共享：字段、取值、命名均按行李运输理赔域重新设计。
 */

/** 会员可选择的赔付方案（空串表示尚未选择） */
export type AwardPlan = '' | 'full' | 'depreciation' | 'reject'

/** 理赔待办队列中的案件条目 */
export interface ClaimCase {
  /** 工单号，如 BG-20260908-142 */
  id: string
  /** 旅客姓名 */
  passenger: string
  /** 行李类型 */
  luggageType: string
  /** 索赔金额（元） */
  claimAmount: number
  /** 提交时间（MM-DD HH:mm） */
  submittedAt: string
  /** 关联航班号 */
  flightNo: string
  /** 航段 */
  route: string
  /** 是否加急 */
  urgent: boolean
}

/** 沟通线程中的一条消息 */
export interface ThreadMessage {
  id: string
  /** 发言方：旅客 或 客服 */
  role: '旅客' | '客服'
  speaker: string
  time: string
  content: string
  /** 附件文件名（仅旅客申诉材料带附件） */
  attachment?: string
}

/** 行李运输轨迹节点 */
export interface JourneyNode {
  time: string
  stage: string
  note: string
  /** 交付节点高亮 */
  highlight?: boolean
}
