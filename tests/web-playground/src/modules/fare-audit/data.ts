/*
 * 票款稽核 · 共享数据模块
 * 主页面（直销出票记录）与子页（渠道结算流水台）共同引用本文件，
 * 保证两个标签页看到的是同一批结算批次。
 * 全部数据确定性生成，无随机源。
 */
import type { ArrivalStatus, AuditRecord, LedgerEntry, TicketOrder } from './types'

/** 结算批次号 */
export const BATCH_NO = 'JS-202610-B1'

/** 主页面每笔单据数 */
export const PAGE_SIZE = 6
/** 子页每页流水条数 */
export const LEDGER_PAGE_SIZE = 10
/** 出票记录全量规模 */
export const EXPECTED_TOTAL = 48
/** 渠道流水全量规模 */
export const EXPECTED_LEDGER_TOTAL = 80

/* ---------------- 出票记录 ---------------- */

/** 第 1 页（TKT-5500 ~ TKT-5505）为判定核心样本，逐笔显式给出 */
const PAGE_ONE_ORDERS: TicketOrder[] = [
  { tktNo: 'TKT-5500', pnr: 'H8K2QP', route: '上海虹桥—成都天府', passenger: '沈亦岚', issuedAmount: 2480 },
  { tktNo: 'TKT-5501', pnr: 'M4X7TR', route: '杭州萧山—西安咸阳', passenger: '佟嘉树', issuedAmount: 4200 },
  { tktNo: 'TKT-5502', pnr: 'W9D5LN', route: '广州白云—青岛胶东', passenger: '柏思远', issuedAmount: 1360 },
  { tktNo: 'TKT-5503', pnr: 'Q2F8VJ', route: '南京禄口—厦门高崎', passenger: '岑雨桐', issuedAmount: 5760 },
  { tktNo: 'TKT-5504', pnr: 'Z6N3HC', route: '深圳宝安—昆明长水', passenger: '傅望舒', issuedAmount: 3150 },
  { tktNo: 'TKT-5505', pnr: 'K7Y4BS', route: '成都天府—三亚凤凰', passenger: '桂晚舟', issuedAmount: 1980 },
]

const ROUTE_POOL = [
  '北京大兴—贵阳龙洞堡',
  '重庆江北—大连周水子',
  '武汉天河—海口美兰',
  '长沙黄花—兰州中川',
  '西安咸阳—宁波栎社',
  '昆明长水—济南遥墙',
  '郑州新郑—珠海金湾',
  '青岛胶东—南昌昌北',
  '天津滨海—南宁吴圩',
  '合肥新桥—丽江三义',
  '温州龙湾—太原武宿',
  '哈尔滨太平—福州长乐',
]

const NAME_POOL = [
  '饶清晏', '邵千帆', '窦春山', '廖星野', '翟语汀', '祁怀谷', '华清让', '滕雁回',
  '温叙白', '庄未央', '湛之桓', '应眠棠', '居慎行', '庾青野', '益文茵', '任鸿飞',
  '盛怀瑾', '薄惊鸿', '糜芷宁', '池砚秋', '覃鹿鸣', '阮扶摇', '楼听澜', '简栖迟',
  '靳望岫', '闻人夏', '墨流苏', '练飞白', '寇云帆', '阚紫岚', '东靖琪', '昝明月',
  '浦照君', '涂修远', '祝清越', '封九思', '逄星白', '桑晚照', '綦梦泽', '逯青梧',
  '岳泓静', '帅文澜', '宗怀璧', '广云岫', '湛芦月', '官疏桐', '覃疏影', '鱼歌阑',
]

const PNR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function makePnr(seed: number): string {
  let x = (seed * 7919 + 104729) % 0x7fffffff
  let code = ''
  for (let i = 0; i < 6; i += 1) {
    x = (x * 48271) % 0x7fffffff
    code += PNR_ALPHABET[x % PNR_ALPHABET.length]
  }
  return code
}

function makeAmount(tkt: number): number {
  const base = 620 + ((tkt * 347) % 5240)
  return tkt % 9 === 0 ? base + 0.5 : base
}

/** 第 2 页起的其余 42 笔，航线 / 旅客 / 票价按序循环铺开 */
const REST_ORDERS: TicketOrder[] = Array.from({ length: 42 }, (_, i) => {
  const tkt = 5506 + i
  return {
    tktNo: `TKT-${tkt}`,
    pnr: makePnr(tkt),
    route: ROUTE_POOL[i % ROUTE_POOL.length],
    passenger: NAME_POOL[i % NAME_POOL.length],
    issuedAmount: makeAmount(tkt),
  }
})

export const ORDERS: TicketOrder[] = [...PAGE_ONE_ORDERS, ...REST_ORDERS]

/* ---------------- 渠道结算流水 ---------------- */

/** 流水中缺失本票的客票（第 1 页为 TKT-5503） */
export const MISSING_TKTS = ['TKT-5503', 'TKT-5519', 'TKT-5537']

/** 存在结算差额的客票：结算金额 = 出票金额 - 渠道扣减 */
const CHANNEL_DEDUCTIONS: Record<string, number> = {
  'TKT-5501': 400,
  'TKT-5512': 260,
  'TKT-5526': 95,
  'TKT-5540': 320,
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function tradeTime(tkt: number, seq: number): string {
  const day = 5 + (seq % 8)
  const hour = 8 + ((tkt * 7) % 13)
  const minute = (tkt * 13) % 60
  const second = (tkt * 29) % 60
  return `2026-10-${pad2(day)} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}`
}

interface RawLedger {
  tktNo: string
  tradedAt: string
  settleAmount: number
  channelFee: number
}

function buildRawLedger(): RawLedger[] {
  const raw: RawLedger[] = []

  for (const order of ORDERS) {
    if (MISSING_TKTS.includes(order.tktNo)) continue
    const deduction = CHANNEL_DEDUCTIONS[order.tktNo] ?? 0
    const tkt = Number(order.tktNo.slice(4))
    raw.push({
      tktNo: order.tktNo,
      tradedAt: tradeTime(tkt, tkt % 45),
      settleAmount: Math.round((order.issuedAmount - deduction) * 100) / 100,
      channelFee: deduction,
    })
  }

  // 批次外流水（下一结算期 TKT-56xx 已先行入账），凑足台账规模
  for (let i = 0; i < 35; i += 1) {
    const tkt = 5600 + i
    const amount = 480 + ((tkt * 211) % 4200)
    raw.push({
      tktNo: `TKT-${tkt}`,
      tradedAt: tradeTime(tkt, i),
      settleAmount: amount,
      channelFee: i % 9 === 4 ? 15 : 0,
    })
  }

  return raw
}

function arrivalFor(index: number): ArrivalStatus {
  if (index % 11 === 3) return '在途'
  if (index % 17 === 5) return '挂账'
  return '已到账'
}

function buildLedger(): LedgerEntry[] {
  const sorted = [...buildRawLedger()].sort((a, b) => a.tradedAt.localeCompare(b.tradedAt))
  return sorted.map((entry, index) => ({
    ledgerNo: `STL-2610-${String(index + 1).padStart(4, '0')}`,
    tktNo: entry.tktNo,
    tradedAt: entry.tradedAt,
    settleAmount: entry.settleAmount,
    channelFee: entry.channelFee,
    arrival: arrivalFor(index),
  }))
}

export const LEDGER_ENTRIES: LedgerEntry[] = buildLedger()

/* ---------------- 状态与工具 ---------------- */

/** 生成全量「待核销」初始登记表，初始化与重置共用 */
export function blankAuditState(): Record<string, AuditRecord> {
  const map: Record<string, AuditRecord> = {}
  for (const order of ORDERS) {
    map[order.tktNo] = { state: '待核销', actualAmount: null, reason: '' }
  }
  return map
}

/** 金额格式化（千分位 + 两位小数） */
export function formatMoney(value: number): string {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 子页流水检索：关键字匹配票号 / 流水号，叠加到账状态筛选 */
export function filterLedger(
  entries: LedgerEntry[],
  keyword: string,
  arrival: ArrivalStatus | 'all',
): LedgerEntry[] {
  const kw = keyword.trim().toUpperCase()
  return entries.filter((entry) => {
    if (arrival !== 'all' && entry.arrival !== arrival) return false
    if (!kw) return true
    return entry.tktNo.toUpperCase().includes(kw) || entry.ledgerNo.toUpperCase().includes(kw)
  })
}
