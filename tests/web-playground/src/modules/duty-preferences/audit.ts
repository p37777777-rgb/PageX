/*
 * 值勤偏好判定逻辑（纯函数）：
 * 输入页面终态快照，输出 InspectionItem[]。
 * 判定 key 与 registry 中 duty-prefs 模块的 steps 对齐。
 */
import type { InspectionItem } from '../../probe/types'
import { flagMatches, okItem, pendingItem, valueMatches } from '../../probe/items'
import type { DutyPrefsSnapshot } from './state'

/** 目标静默窗口 */
export const QUIET_WINDOW = { start: '02:00', end: '05:30' } as const

/** 汇总告警通知开关的可读文本 */
function alarmSummary(alarms: DutyPrefsSnapshot['alarms']): string {
  const labels: Array<[string, boolean]> = [
    ['航班动态', alarms.flight],
    ['系统公告', alarms.notice],
    ['气象预警', alarms.weather],
    ['旅客服务', alarms.passenger],
    ['合作推广', alarms.promo],
  ]
  return labels.map(([name, on]) => `${name}${on ? '开' : '关'}`).join(' / ')
}

export function auditDutyPreferences(s: DutyPrefsSnapshot): InspectionItem[] {
  const items: InspectionItem[] = []

  items.push(valueMatches('language', '界面语言改为 English', 'English', s.language))
  items.push(valueMatches('theme', '外观主题改为深色', '深色', s.theme))
  items.push(valueMatches('time-basis', '时间基准改为 UTC', 'UTC', s.timeBasis))

  const onlyFlight =
    s.alarms.flight &&
    !s.alarms.notice &&
    !s.alarms.weather &&
    !s.alarms.passenger &&
    !s.alarms.promo
  items.push(
    flagMatches(
      'notify',
      '告警通知仅保留「航班动态」',
      onlyFlight,
      '仅航班动态开启，其余全部关闭',
      alarmSummary(s.alarms),
    ),
  )

  items.push(
    flagMatches(
      'quiet-window',
      '静默时段调整为 02:00 至 05:30',
      s.quietStart === QUIET_WINDOW.start && s.quietEnd === QUIET_WINDOW.end,
      '02:00 / 05:30',
      `${s.quietStart} / ${s.quietEnd}`,
    ),
  )

  items.push(valueMatches('report-frequency', '运行日报改为每周一推送', '每周一', s.reportFreq))

  items.push(
    flagMatches(
      'security-verify',
      '已完成一次安全验证',
      s.verifyPassed,
      '动态口令验证通过',
      s.verifyPassed ? '已通过' : '未通过',
    ),
  )

  const shanghaiOnline = s.terminalSites.some((site) => site.includes('上海'))
  items.push(
    flagMatches(
      'terminal-shanghai',
      '位于上海的值勤终端已下线',
      !shanghaiOnline,
      '值勤终端列表不含上海',
      shanghaiOnline ? s.terminalSites.join('、') : '无上海终端在列',
    ),
  )

  items.push(
    flagMatches(
      'smart-release',
      '已开启实验特性「智能放轮」',
      s.labEnabled && s.smartRelease,
      '实验特性已启用且智能放轮开启',
      `实验特性${s.labEnabled ? '已启用' : '未启用'} / 智能放轮${s.smartRelease ? '开' : '关'}`,
    ),
  )

  const sawSept2 = s.loadedLogDates.some((date) => date === '09-02')
  items.push(
    sawSept2
      ? okItem('audit-log-0902', '09-02 的账号操作流水已加载查看', '流水已包含 09-02 记录')
      : pendingItem('audit-log-0902', '汇报 09-02 的账号操作流水', '09-02 流水尚未加载，页面无法判定'),
  )

  items.push(
    flagMatches('saved', '已保存以上设置', s.saved, '出现保存成功回执', s.saved ? '已保存' : '未保存'),
  )

  return items
}
