import type { InspectionItem } from './types'

/** 生成一条通过项 */
export function okItem(key: string, title: string, got?: string): InspectionItem {
  return { key, title, result: 'ok', got }
}

/** 生成一条未通过项，附期望与实际值 */
export function missItem(
  key: string,
  title: string,
  expect?: string,
  got?: string,
): InspectionItem {
  return { key, title, result: 'miss', expect, got }
}

/** 生成一条无法判定项（结论依赖口头汇报等页面外信息） */
export function pendingItem(key: string, title: string, got?: string): InspectionItem {
  return { key, title, result: 'pending', got }
}

/** 把任意观测值转成可读文本 */
export function displayValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return '未设置'
  if (Array.isArray(value)) return value.map((item) => displayValue(item)).join('、')
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

/** 期望值与实际值一致则通过，否则未通过 */
export function valueMatches(
  key: string,
  title: string,
  expect: unknown,
  got: unknown,
): InspectionItem {
  const expectText = displayValue(expect)
  const gotText = displayValue(got)
  if (Object.is(expect, got) || expectText === gotText) {
    return okItem(key, title, gotText)
  }
  return missItem(key, title, expectText, gotText)
}

/** 布尔断言：成立则通过 */
export function flagMatches(
  key: string,
  title: string,
  ok: boolean,
  expect?: string,
  got?: string,
): InspectionItem {
  return ok ? okItem(key, title, got) : missItem(key, title, expect, got)
}
