/**
 * 特殊服务申请的审计纯函数：状态快照 → InspectionItem[]。
 * 只依赖 probe/items，不依赖 Vue，便于在 node 环境下直接测试。
 */
import { flagMatches, valueMatches } from '../../probe/items'
import type { InspectionItem } from '../../probe/types'
import {
  AIRPORT_OPTIONS,
  GENDER_OPTIONS,
  ID_TYPE_OPTIONS,
  MEAL_OPTIONS,
  SERVICE_TYPE_OPTIONS,
} from './options'
import type { SelectOption } from './options'
import type { ServiceRequestSnapshot } from './types'

/** 在候选集中按 value 取展示名，取不到返回空串 */
export function labelOf(options: readonly SelectOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? ''
}

/** 申请单初始态（页面加载与重置共用） */
export function createEmptySnapshot(): ServiceRequestSnapshot {
  return {
    passengerName: '',
    gender: '',
    birthDate: '',
    phone: '',
    email: '',
    idType: '',
    idNumber: '',
    flightNo: '',
    flightDate: '',
    departureAirport: '',
    arrivalAirport: '',
    boardingTime: '',
    serviceTypes: [],
    meal: '',
    companions: 0,
    remark: '',
    smsNotify: true,
    experienceRating: 0,
    serviceFee: 120,
    agreed: false,
    submitted: false,
    receiptNo: '',
  }
}

/** 理想提交快照：全部判定项应通过的基准数据 */
export function buildIdealSnapshot(): ServiceRequestSnapshot {
  return {
    ...createEmptySnapshot(),
    passengerName: '顾清悦',
    gender: 'female',
    birthDate: '1988-09-23',
    phone: '13700002211',
    email: 'guqingyue@example.com',
    idType: 'id-card',
    idNumber: '310104198809235629',
    flightNo: 'MU2317',
    flightDate: '2026-06-02',
    departureAirport: 'SHA',
    arrivalAirport: 'SZX',
    boardingTime: '07:45',
    serviceTypes: ['wheelchair'],
    meal: 'low-sugar',
    companions: 1,
    remark: '轮椅旅客，餐食需低糖，请安排前排就座。',
    smsNotify: false,
    experienceRating: 5,
    serviceFee: 200,
    agreed: true,
    submitted: true,
    receiptNo: 'SSA-20260602-4816',
  }
}

/** 只读审计：把申请单快照核对成逐字段的判定项清单 */
export function auditSnapshot(s: ServiceRequestSnapshot): InspectionItem[] {
  const serviceText =
    s.serviceTypes.map((value) => labelOf(SERVICE_TYPE_OPTIONS, value)).join('、') || '未选择'
  return [
    valueMatches('passenger-name', '旅客姓名为「顾清悦」', '顾清悦', s.passengerName.trim()),
    valueMatches('gender', '性别选择「女」', '女', labelOf(GENDER_OPTIONS, s.gender)),
    valueMatches('birth-date', '出生日期为 1988-09-23', '1988-09-23', s.birthDate),
    valueMatches('phone', '联系手机为 13700002211', '13700002211', s.phone.trim()),
    valueMatches('email', '联系邮箱为 guqingyue@example.com', 'guqingyue@example.com', s.email.trim()),
    valueMatches('id-type', '证件类型为「居民身份证」', '居民身份证', labelOf(ID_TYPE_OPTIONS, s.idType)),
    valueMatches(
      'id-number',
      '证件号码为 310104198809235629',
      '310104198809235629',
      s.idNumber.trim().toUpperCase(),
    ),
    valueMatches('flight-no', '航班号为 MU2317', 'MU2317', s.flightNo.trim().toUpperCase()),
    valueMatches('flight-date', '航班日期为 2026-06-02', '2026-06-02', s.flightDate),
    valueMatches(
      'departure-airport',
      '出发机场为上海虹桥 T2',
      '上海虹桥国际机场 T2（SHA）',
      labelOf(AIRPORT_OPTIONS, s.departureAirport),
    ),
    valueMatches(
      'arrival-airport',
      '到达机场为深圳宝安 T3',
      '深圳宝安国际机场 T3（SZX）',
      labelOf(AIRPORT_OPTIONS, s.arrivalAirport),
    ),
    valueMatches('boarding-time', '登机时间为 07:45', '07:45', s.boardingTime),
    flagMatches(
      'service-types',
      '服务类型包含「轮椅协助」',
      s.serviceTypes.includes('wheelchair'),
      '包含轮椅协助',
      serviceText,
    ),
    valueMatches('meal', '特殊餐食为「低糖餐」', '低糖餐', labelOf(MEAL_OPTIONS, s.meal)),
    valueMatches('companions', '随行人数为 1', 1, s.companions),
    valueMatches('sms-notify', '短信通知保持关闭', false, s.smsNotify),
    valueMatches('experience-rating', '体验预期评 5 分', 5, s.experienceRating),
    valueMatches('service-fee', '可接受服务费为 200 元', 200, s.serviceFee),
    flagMatches(
      'remark',
      '备注包含「低糖」',
      s.remark.includes('低糖'),
      '备注含低糖',
      s.remark.trim() || '未填写',
    ),
    flagMatches(
      'submitted',
      '申请已提交并生成回执',
      s.submitted && s.receiptNo !== '',
      '已提交出回执',
      s.submitted ? `回执 ${s.receiptNo}` : '未提交',
    ),
  ]
}
