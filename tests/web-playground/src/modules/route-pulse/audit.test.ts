import { describe, expect, it } from 'vitest'
import { runAudit } from './audit'
import type { PageTrace } from './audit'
import {
  CHANNEL_TEXT,
  FOCUS_ROUTE_ID,
  LEG_DETAILS,
  MONTH_LABELS,
  ROUTES,
  filterLegs,
  formatPax,
  formatRevenue,
  monthlyRevenue,
  peakMonth,
  routeRankByRevenue,
  summarize,
} from './model'
import { DEFAULT_FILTERS } from './model'

const fullTrace: PageTrace = {
  channelSeen: ['all', 'direct', 'agent'],
  routeTypeSeen: ['all', 'domestic'],
  routeSearchUsed: true,
  routePicked: FOCUS_ROUTE_ID,
  chartCount: 2,
  tableRowCount: ROUTES.length,
}

const emptyTrace: PageTrace = {
  channelSeen: ['all'],
  routeTypeSeen: ['all'],
  routeSearchUsed: false,
  routePicked: '',
  chartCount: 0,
  tableRowCount: 0,
}

describe('runAudit 判定逻辑', () => {
  it('痕迹齐全时：可观测项全部 ok，结论项保持 pending，且无 miss', () => {
    const items = runAudit(fullTrace)
    expect(items).toHaveLength(12)
    expect(items.some((item) => item.result === 'miss')).toBe(false)

    const pendings = items.filter((item) => item.result === 'pending')
    expect(pendings.map((item) => item.key)).toEqual([
      'kpi-direct',
      'agent-compare',
      'focus-domestic-rank',
      'peak-revenue-month',
      'summary-conclusion',
    ])
    for (const item of items) {
      if (item.result !== 'pending') expect(item.result).toBe('ok')
    }
  })

  it('无任何交互痕迹时：可观测项全部 miss，结论项仍是 pending', () => {
    const items = runAudit(emptyTrace)
    const pendings = items.filter((item) => item.result === 'pending')
    expect(pendings).toHaveLength(5)
    const observable = items.filter((item) => item.key !== 'summary-conclusion' && !pendings.includes(item))
    expect(observable.every((item) => item.result === 'miss')).toBe(true)
  })

  it('只切到直销、未选航线时：直销 ok、代理 miss、选中项 miss', () => {
    const items = runAudit({
      ...emptyTrace,
      channelSeen: ['all', 'direct'],
    })
    const byKey = new Map(items.map((item) => [item.key, item]))
    expect(byKey.get('channel-direct-viewed')?.result).toBe('ok')
    expect(byKey.get('channel-agent-viewed')?.result).toBe('miss')
    expect(byKey.get('route-focus-selected')?.result).toBe('miss')
    expect(byKey.get('kpi-direct')?.result).toBe('pending')
  })

  it('图表只渲染了一张时 charts-rendered 判 miss', () => {
    const items = runAudit({ ...fullTrace, chartCount: 1 })
    const target = items.find((item) => item.key === 'charts-rendered')
    expect(target?.result).toBe('miss')
    expect(target?.got).toBe('已渲染 1 张')
  })
})

describe('确定性明细数据', () => {
  it('规模为 航线数 × 12 月 × 2 渠道，且字段取值合法', () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(8)
    expect(LEG_DETAILS).toHaveLength(ROUTES.length * 12 * 2)
    for (const leg of LEG_DETAILS) {
      expect(leg.month).toBeGreaterThanOrEqual(0)
      expect(leg.month).toBeLessThanOrEqual(11)
      expect(leg.revenueWan).toBeGreaterThan(0)
      expect(leg.pax).toBeGreaterThan(0)
      expect(leg.loadPct).toBeGreaterThanOrEqual(60)
      expect(leg.loadPct).toBeLessThanOrEqual(90)
    }
  })

  it('同一份种子重复生成结果一致（确定性）', () => {
    const first = summarize(LEG_DETAILS)
    const second = summarize([...LEG_DETAILS].reverse())
    expect(second.revenueWan).toBe(first.revenueWan)
    expect(second.pax).toBe(first.pax)
  })
})

describe('筛选与汇总', () => {
  it('直销口径：行内渠道全部为直销，收入低于全渠道，航线数为全部航线', () => {
    const direct = filterLegs({ ...DEFAULT_FILTERS, channel: 'direct' })
    expect(direct.length).toBeGreaterThan(0)
    expect(direct.every((leg) => leg.channel === 'direct')).toBe(true)
    const directKpi = summarize(direct)
    const allKpi = summarize(LEG_DETAILS)
    expect(directKpi.revenueWan).toBeLessThan(allKpi.revenueWan)
    expect(directKpi.pax).toBeLessThan(allKpi.pax)
    expect(directKpi.activeRoutes).toBe(ROUTES.length)
  })

  it('代理口径：收入低于全渠道，且与直销收入不相等', () => {
    const agentKpi = summarize(filterLegs({ ...DEFAULT_FILTERS, channel: 'agent' }))
    const directKpi = summarize(filterLegs({ ...DEFAULT_FILTERS, channel: 'direct' }))
    expect(agentKpi.revenueWan).toBeLessThan(summarize(LEG_DETAILS).revenueWan)
    expect(agentKpi.revenueWan).not.toBe(directKpi.revenueWan)
  })

  it('国内类型口径：只含国内航线', () => {
    const domestic = filterLegs({ ...DEFAULT_FILTERS, routeType: 'domestic' })
    const domesticIds = new Set(domestic.map((leg) => leg.routeId))
    expect(domesticIds.size).toBe(5)
    expect(domesticIds.has(FOCUS_ROUTE_ID)).toBe(true)
  })

  it('航线口径：只含该航线 12 个月 × 2 渠道', () => {
    const rows = filterLegs({ ...DEFAULT_FILTERS, routeId: FOCUS_ROUTE_ID })
    expect(rows).toHaveLength(24)
    expect(rows.every((leg) => leg.routeId === FOCUS_ROUTE_ID)).toBe(true)
  })

  it('summarize 结果与独立归约一致', () => {
    const kpi = summarize(LEG_DETAILS)
    let revenue = 0
    let pax = 0
    for (const leg of LEG_DETAILS) {
      revenue += leg.revenueWan
      pax += leg.pax
    }
    expect(kpi.revenueWan).toBe(revenue)
    expect(kpi.pax).toBe(pax)
    expect(kpi.activeRoutes).toBe(ROUTES.length)
  })
})

describe('排名与峰值（验收问题可回答）', () => {
  it('「成都—三亚」在国内航线中收入排名第 2（上海—北京第 1）', () => {
    const focus = routeRankByRevenue(FOCUS_ROUTE_ID, 'domestic')
    expect(focus).not.toBeNull()
    expect(focus?.total).toBe(5)
    expect(focus?.rank).toBe(2)

    const top = routeRankByRevenue('SHA-PEK', 'domestic')
    expect(top?.rank).toBe(1)
  })

  it('国际、地区航线数量正确，类型外航线返回 null', () => {
    expect(routeRankByRevenue('PVG-FRA', 'international')?.total).toBe(3)
    expect(routeRankByRevenue('FOC-HKG', 'regional')?.total).toBe(2)
    expect(routeRankByRevenue('FOC-HKG', 'domestic')).toBeNull()
  })

  it('月度序列长度 12，峰值月份与独立最大值一致', () => {
    const totals = monthlyRevenue(LEG_DETAILS)
    expect(totals).toHaveLength(12)
    const peak = peakMonth(LEG_DETAILS)
    expect(peak.revenueWan).toBe(Math.max(...totals))
    expect(peak.label).toBe(MONTH_LABELS[peak.month])
    expect(peak.label).toBe('2027-01')
  })

  it('直销口径下峰值函数同样可用', () => {
    const directPeak = peakMonth(filterLegs({ ...DEFAULT_FILTERS, channel: 'direct' }))
    expect(directPeak.month).toBeGreaterThanOrEqual(0)
    expect(directPeak.revenueWan).toBeGreaterThan(0)
  })
})

describe('展示格式化', () => {
  it('收入达到亿元级与万元级的两种格式', () => {
    expect(formatRevenue(12500)).toBe('1.25 亿元')
    expect(formatRevenue(8600)).toBe('8,600 万元')
  })

  it('旅客量达到万人次级与人次级的两种格式', () => {
    expect(formatPax(15230)).toBe('1.5 万人次')
    expect(formatPax(940)).toBe('940 人次')
  })

  it('渠道与类型中文文案覆盖完整', () => {
    expect(CHANNEL_TEXT.direct).toBe('直销')
    expect(CHANNEL_TEXT.agent).toBe('代理')
  })
})
