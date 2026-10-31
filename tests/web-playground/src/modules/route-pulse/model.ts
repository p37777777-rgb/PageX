/*
 * 航线洞察 · 数据模型与纯函数
 * 所有数据由固定种子派生（无随机、无时间依赖），保证任何一次会话中
 * 同一筛选口径下的答案完全一致，供被测 Agent 读表读图得出结论。
 */

export type ChannelKey = 'all' | 'direct' | 'agent'
export type RouteTypeKey = 'all' | 'domestic' | 'international' | 'regional'
export type RouteType = Exclude<RouteTypeKey, 'all'>
export type Channel = Exclude<ChannelKey, 'all'>

export interface RouteDef {
  id: string
  name: string
  type: RouteType
  /** 全渠道月度基准客运收入（万元） */
  baseWan: number
  /** 直销渠道收入占比基准 */
  directShare: number
  /** 单客票面基准（元） */
  fareBase: number
}

export interface LegDetail {
  routeId: string
  /** 0..11，对应 MONTH_LABELS 下标 */
  month: number
  channel: Channel
  revenueWan: number
  pax: number
  loadPct: number
}

export interface DashboardFilters {
  channel: ChannelKey
  routeType: RouteTypeKey
  routeId: string
}

export interface KpiSummary {
  revenueWan: number
  pax: number
  loadPct: number
  activeRoutes: number
}

export interface RouteAgg {
  routeId: string
  name: string
  type: RouteType
  revenueWan: number
  pax: number
  loadPct: number
}

export interface MonthPeak {
  month: number
  label: string
  revenueWan: number
}

export interface RouteRank {
  rank: number
  total: number
  revenueWan: number
}

export const DEFAULT_FILTERS: DashboardFilters = {
  channel: 'all',
  routeType: 'all',
  routeId: '',
}

export const SEASON_TAG = '2026/27 冬春航季'

export const MONTH_LABELS = [
  '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03',
  '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09',
]

export const CHANNEL_TEXT: Record<ChannelKey, string> = {
  all: '全渠道',
  direct: '直销',
  agent: '代理',
}

export const ROUTE_TYPE_TEXT: Record<RouteTypeKey, string> = {
  all: '全部',
  domestic: '国内',
  international: '国际',
  regional: '地区',
}

export const CHANNEL_OPTIONS: { value: ChannelKey; label: string }[] = (
  ['all', 'direct', 'agent'] as ChannelKey[]
).map((value) => ({ value, label: CHANNEL_TEXT[value] }))

export const ROUTE_TYPE_OPTIONS: { value: RouteTypeKey; label: string }[] = (
  ['all', 'domestic', 'international', 'regional'] as RouteTypeKey[]
).map((value) => ({ value, label: ROUTE_TYPE_TEXT[value] }))

/** 「成都—三亚」航线（验收关注的航线） */
export const FOCUS_ROUTE_ID = 'CTU-SYX'

export const ROUTES: RouteDef[] = [
  { id: 'CTU-SYX', name: '成都—三亚', type: 'domestic', baseWan: 3600, directShare: 0.47, fareBase: 860 },
  { id: 'SHA-PEK', name: '上海—北京', type: 'domestic', baseWan: 4200, directShare: 0.44, fareBase: 920 },
  { id: 'KMG-LJG', name: '昆明—丽江', type: 'domestic', baseWan: 1500, directShare: 0.52, fareBase: 640 },
  { id: 'HRB-SYX', name: '哈尔滨—三亚', type: 'domestic', baseWan: 1750, directShare: 0.41, fareBase: 1080 },
  { id: 'HGH-XIY', name: '杭州—西安', type: 'domestic', baseWan: 1400, directShare: 0.49, fareBase: 760 },
  { id: 'PVG-FRA', name: '上海—法兰克福', type: 'international', baseWan: 5100, directShare: 0.38, fareBase: 3100 },
  { id: 'XMN-BKK', name: '厦门—曼谷', type: 'international', baseWan: 2150, directShare: 0.43, fareBase: 1980 },
  { id: 'CKG-SIN', name: '重庆—新加坡', type: 'international', baseWan: 1900, directShare: 0.46, fareBase: 2240 },
  { id: 'FOC-HKG', name: '福州—香港', type: 'regional', baseWan: 1250, directShare: 0.5, fareBase: 1520 },
  { id: 'SZX-MFM', name: '深圳—澳门', type: 'regional', baseWan: 950, directShare: 0.55, fareBase: 880 },
]

export function routeById(routeId: string): RouteDef | undefined {
  return ROUTES.find((route) => route.id === routeId)
}

/* ---------------- 确定性数据生成 ---------------- */

function hashSeed(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** [-1, 1] 的确定性扰动 */
function noise(seed: string): number {
  return (hashSeed(seed) / 0xffffffff) * 2 - 1
}

/** 冬春航季客运节奏：春运所在月（下标 3）为峰值 */
function seasonal(month: number): number {
  return 1 + 0.5 * Math.cos(((month - 3) / 12) * Math.PI * 2)
}

const CHANNELS: Channel[] = ['direct', 'agent']

export const LEG_DETAILS: LegDetail[] = ROUTES.flatMap((route) =>
  MONTH_LABELS.flatMap((_, month) =>
    CHANNELS.map((channel) => {
      const share = channel === 'direct' ? route.directShare : 1 - route.directShare
      const revenueWan = Math.round(
        route.baseWan * share * seasonal(month) * (1 + noise(`${route.id}|${channel}|${month}`) * 0.06),
      )
      const fare = Math.round(route.fareBase * (1 + noise(`${route.id}|fare|${month}`) * 0.1))
      const pax = Math.round((revenueWan * 10000) / fare)
      const loadPct = Math.round(74 + noise(`${route.id}|load|${channel}|${month}`) * 12)
      return { routeId: route.id, month, channel, revenueWan, pax, loadPct }
    }),
  ),
)

/* ---------------- 筛选与聚合 ---------------- */

export function filterLegs(
  filters: DashboardFilters,
  legs: LegDetail[] = LEG_DETAILS,
): LegDetail[] {
  return legs.filter((leg) => {
    if (filters.channel !== 'all' && leg.channel !== filters.channel) return false
    if (filters.routeType !== 'all' && routeById(leg.routeId)?.type !== filters.routeType) return false
    if (filters.routeId && leg.routeId !== filters.routeId) return false
    return true
  })
}

export function summarize(legs: LegDetail[]): KpiSummary {
  const revenueWan = legs.reduce((sum, leg) => sum + leg.revenueWan, 0)
  const pax = legs.reduce((sum, leg) => sum + leg.pax, 0)
  const loadPct = pax
    ? Math.round(legs.reduce((sum, leg) => sum + leg.loadPct * leg.pax, 0) / pax)
    : 0
  return {
    revenueWan,
    pax,
    loadPct,
    activeRoutes: new Set(legs.map((leg) => leg.routeId)).size,
  }
}

export function monthlyRevenue(legs: LegDetail[]): number[] {
  const totals = new Array<number>(MONTH_LABELS.length).fill(0)
  for (const leg of legs) totals[leg.month] += leg.revenueWan
  return totals
}

/** 按当前口径对航线聚合，收入降序 */
export function routeAggregates(legs: LegDetail[]): RouteAgg[] {
  const buckets = new Map<string, LegDetail[]>()
  for (const leg of legs) {
    const bucket = buckets.get(leg.routeId)
    if (bucket) bucket.push(leg)
    else buckets.set(leg.routeId, [leg])
  }
  const rows: RouteAgg[] = []
  for (const [routeId, items] of buckets) {
    const route = routeById(routeId)
    if (!route) continue
    const summary = summarize(items)
    rows.push({
      routeId,
      name: route.name,
      type: route.type,
      revenueWan: summary.revenueWan,
      pax: summary.pax,
      loadPct: summary.loadPct,
    })
  }
  return rows.sort((a, b) => b.revenueWan - a.revenueWan)
}

/** 当前口径下收入最高的月份 */
export function peakMonth(legs: LegDetail[]): MonthPeak {
  if (legs.length === 0) return { month: -1, label: '', revenueWan: 0 }
  const totals = monthlyRevenue(legs)
  let best = 0
  for (let i = 1; i < totals.length; i++) {
    if (totals[i] > totals[best]) best = i
  }
  return { month: best, label: MONTH_LABELS[best], revenueWan: totals[best] }
}

/** 指定航线在指定航线类型（全渠道口径）下的收入排名 */
export function routeRankByRevenue(
  routeId: string,
  routeType: RouteType,
  legs: LegDetail[] = LEG_DETAILS,
): RouteRank | null {
  const ranked = routeAggregates(legs.filter((leg) => routeById(leg.routeId)?.type === routeType))
  const index = ranked.findIndex((row) => row.routeId === routeId)
  if (index < 0) return null
  return { rank: index + 1, total: ranked.length, revenueWan: ranked[index].revenueWan }
}

/* ---------------- 展示格式化 ---------------- */

export function formatRevenue(wan: number): string {
  if (wan >= 10000) return `${(wan / 10000).toFixed(2)} 亿元`
  return `${Math.round(wan).toLocaleString()} 万元`
}

export function formatPax(pax: number): string {
  if (pax >= 10000) return `${(pax / 10000).toFixed(1)} 万人次`
  return `${Math.round(pax).toLocaleString()} 人次`
}
