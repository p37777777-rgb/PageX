/*
 * 航线洞察 · 体检判定
 * 参考 decision：分析结论依赖口头汇报，页面无终态可判定 → 一律 pending；
 * 只对页面上可观测的交互痕迹（筛选切换、搜索使用、图表/表格渲染）做 ok / miss。
 */
import type { InspectionItem } from '../../probe'
import { flagMatches, pendingItem } from '../../probe'
import { CHANNEL_TEXT, FOCUS_ROUTE_ID, ROUTE_TYPE_TEXT } from './model'
import type { ChannelKey, RouteTypeKey } from './model'

/** 页面可观测交互痕迹（由组件在运行期间收集，只读供判定） */
export interface PageTrace {
  /** 曾被选中的销售渠道（含初始全渠道） */
  channelSeen: ChannelKey[]
  /** 曾被选中的航线类型（含初始全部） */
  routeTypeSeen: RouteTypeKey[]
  /** 航线可搜索下拉执行过非空搜索 */
  routeSearchUsed: boolean
  /** 航线下拉最终选中的航线 id */
  routePicked: string
  /** 已成功初始化的图表数量 */
  chartCount: number
  /** 明细表当前行数 */
  tableRowCount: number
}

export const OBSERVABLE_KEYS = [
  'channel-direct-viewed',
  'channel-agent-viewed',
  'route-type-domestic',
  'route-search-used',
  'route-focus-selected',
  'charts-rendered',
  'table-rendered',
] as const

export const PENDING_KEYS = [
  'kpi-direct',
  'agent-compare',
  'focus-domestic-rank',
  'peak-revenue-month',
  'summary-conclusion',
] as const

export function runAudit(trace: PageTrace): InspectionItem[] {
  const channelText = trace.channelSeen.map((key) => CHANNEL_TEXT[key]).join('、')
  const routeTypeText = trace.routeTypeSeen.map((key) => ROUTE_TYPE_TEXT[key]).join('、')
  const unreachable = '结论依赖口头汇报，页面无终态可判定'

  return [
    flagMatches(
      'channel-direct-viewed',
      '销售渠道筛选切换到过「直销」',
      trace.channelSeen.includes('direct'),
      '渠道下拉出现过直销',
      `观测到渠道：${channelText || '无'}`,
    ),
    flagMatches(
      'channel-agent-viewed',
      '销售渠道筛选切换到过「代理」',
      trace.channelSeen.includes('agent'),
      '渠道下拉出现过代理',
      `观测到渠道：${channelText || '无'}`,
    ),
    flagMatches(
      'route-type-domestic',
      '航线类型筛选使用过「国内」',
      trace.routeTypeSeen.includes('domestic'),
      '类型下拉出现过国内',
      `观测到类型：${routeTypeText || '无'}`,
    ),
    flagMatches(
      'route-search-used',
      '可搜索航线选择器执行过搜索',
      trace.routeSearchUsed,
      '在航线搜索框输入过关键字',
      trace.routeSearchUsed ? '已执行搜索' : '未搜索',
    ),
    flagMatches(
      'route-focus-selected',
      '航线选择器选中过「成都—三亚」',
      trace.routePicked === FOCUS_ROUTE_ID,
      `选中 ${FOCUS_ROUTE_ID}`,
      trace.routePicked || '未选择',
    ),
    flagMatches(
      'charts-rendered',
      '月度趋势与航线排行图表已渲染',
      trace.chartCount >= 2,
      '两张图表 canvas 就绪',
      `已渲染 ${trace.chartCount} 张`,
    ),
    flagMatches(
      'table-rendered',
      '航线明细表已展示数据',
      trace.tableRowCount > 0,
      '明细表至少一行',
      `当前 ${trace.tableRowCount} 行`,
    ),
    pendingItem('kpi-direct', '统计 2026/27 冬春航季直销渠道的客运总收入、总旅客量、平均客座率与在飞航线数', unreachable),
    pendingItem('agent-compare', '对比代理渠道客运总收入与直销的差异', unreachable),
    pendingItem('focus-domestic-rank', '查询「成都—三亚」在国内航线中的收入排名', unreachable),
    pendingItem('peak-revenue-month', '找出 2026/27 冬春航季全渠道客运收入最高的月份', unreachable),
    pendingItem('summary-conclusion', '输出简短的分析结论', unreachable),
  ]
}
