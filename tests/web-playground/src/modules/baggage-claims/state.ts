/*
 * 行李理赔模块的状态层：
 * - 可变状态 + 初始状态工厂（resetModule 整体回滚）
 * - 页面终态只读快照（供纯判定函数消费）
 */
import type { AwardPlan } from './types'
import { TARGET_CASE_ID } from './data'

export interface ClaimState {
  /** 左侧队列当前选中的工单号 */
  selectedId: string
  /** 详情区当前页签 */
  activeTab: 'thread' | 'journey' | 'verdict'
  /** 申诉材料附件是否展开 */
  attachmentExpanded: boolean
  /** 会员权益调研遮罩是否可见 */
  overlayVisible: boolean
  /** 赔付方案 */
  plan: AwardPlan
  /** 赔付金额（元），未填写为 null */
  amount: number | null
  /** 核验依据 */
  basis: string
  /** 是否已提交裁决 */
  submitted: boolean
  /** 裁决回执编号 */
  receiptNo: string
}

/** 判定函数消费的只读快照 */
export interface ClaimSnapshot {
  overlayOpen: boolean
  plan: AwardPlan
  amount: number | null
  basis: string
  submitted: boolean
}

export function createInitialState(): ClaimState {
  return {
    selectedId: TARGET_CASE_ID,
    activeTab: 'thread',
    attachmentExpanded: false,
    overlayVisible: false,
    plan: '',
    amount: null,
    basis: '',
    submitted: false,
    receiptNo: '',
  }
}

export function toSnapshot(state: ClaimState): ClaimSnapshot {
  return {
    overlayOpen: state.overlayVisible,
    plan: state.plan,
    amount: state.amount,
    basis: state.basis,
    submitted: state.submitted,
  }
}
