import { describe, expect, it } from 'vitest'
import type { InspectionItem } from '../../probe/types'
import { auditSnapshot, buildIdealSnapshot, createEmptySnapshot, labelOf } from './audit'
import { AIRPORT_OPTIONS, ID_TYPE_OPTIONS } from './options'
import type { ServiceRequestSnapshot } from './types'

function pick(items: InspectionItem[], key: string): InspectionItem {
  const hit = items.find((item) => item.key === key)
  if (!hit) throw new Error(`缺少判定项 ${key}`)
  return hit
}

const ideal = buildIdealSnapshot()

describe('auditSnapshot 正向用例', () => {
  it('理想提交快照下 20 个判定项全部通过', () => {
    const items = auditSnapshot(ideal)
    expect(items).toHaveLength(20)
    const failed = items.filter((item) => item.result !== 'ok')
    expect(failed.map((item) => `${item.key}: ${item.result}`)).toEqual([])
  })
})

describe('auditSnapshot 反向用例', () => {
  it('单个字段偏差只导致对应判定项未通过', () => {
    const cases: Array<[keyof ServiceRequestSnapshot, unknown, string]> = [
      ['passengerName', '顾清焰', 'passenger-name'],
      ['gender', 'male', 'gender'],
      ['birthDate', '1988-09-24', 'birth-date'],
      ['phone', '13700002212', 'phone'],
      ['email', 'guqingyue@other.com', 'email'],
      ['idType', 'passport', 'id-type'],
      ['idNumber', '310104198809235628', 'id-number'],
      ['flightNo', 'mu2318', 'flight-no'],
      ['flightDate', '2026-06-03', 'flight-date'],
      ['departureAirport', 'PVG', 'departure-airport'],
      ['arrivalAirport', 'CAN', 'arrival-airport'],
      ['boardingTime', '08:45', 'boarding-time'],
      ['meal', 'normal', 'meal'],
      ['companions', 2, 'companions'],
      ['smsNotify', true, 'sms-notify'],
      ['experienceRating', 4, 'experience-rating'],
      ['serviceFee', 180, 'service-fee'],
    ]
    for (const [field, wrong, key] of cases) {
      const snapshot = Object.assign({}, ideal, { [field]: wrong }) as ServiceRequestSnapshot
      const items = auditSnapshot(snapshot)
      expect(pick(items, key).result, `${String(field)} 偏差应判 miss`).toBe('miss')
      const others = items.filter((item) => item.key !== key)
      expect(
        others.every((item) => item.result === 'ok'),
        `${String(field)} 偏差不应影响其他判定项`,
      ).toBe(true)
    }
  })

  it('航班号小写输入仍按规范化比对通过', () => {
    const items = auditSnapshot({ ...ideal, flightNo: 'mu2317 ' })
    expect(pick(items, 'flight-no').result).toBe('ok')
  })

  it('服务类型不含轮椅协助时未通过', () => {
    const items = auditSnapshot({ ...ideal, serviceTypes: ['guide-dog'] })
    expect(pick(items, 'service-types').result).toBe('miss')
    expect(pick(items, 'service-types').expect).toContain('轮椅')
  })

  it('服务类型为空时未通过且实际值提示未选择', () => {
    const items = auditSnapshot({ ...ideal, serviceTypes: [] })
    expect(pick(items, 'service-types').result).toBe('miss')
    expect(pick(items, 'service-types').got).toBe('未选择')
  })

  it('备注不含「低糖」时未通过', () => {
    const items = auditSnapshot({ ...ideal, remark: '请安排安静座位。' })
    expect(pick(items, 'remark').result).toBe('miss')
  })

  it('未提交时 submitted 未通过', () => {
    const items = auditSnapshot({ ...ideal, submitted: false, receiptNo: '' })
    expect(pick(items, 'submitted').result).toBe('miss')
  })

  it('有提交标记但无回执编号时仍未通过', () => {
    const items = auditSnapshot({ ...ideal, receiptNo: '' })
    expect(pick(items, 'submitted').result).toBe('miss')
  })

  it('空白初始快照所有判定项均未通过', () => {
    const items = auditSnapshot(createEmptySnapshot())
    expect(items).toHaveLength(20)
    expect(items.every((item) => item.result === 'miss')).toBe(true)
  })
})

describe('labelOf', () => {
  it('能按 value 取回展示名', () => {
    expect(labelOf(ID_TYPE_OPTIONS, 'id-card')).toBe('居民身份证')
    expect(labelOf(AIRPORT_OPTIONS, 'SHA')).toContain('虹桥')
  })

  it('未知 value 返回空串', () => {
    expect(labelOf(AIRPORT_OPTIONS, 'XXX')).toBe('')
  })
})
