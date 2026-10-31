import { describe, expect, it } from 'vitest'
import { auditDutyPreferences } from './audit'
import { createInitialState, toSnapshot, type DutyPrefsSnapshot } from './state'

/** 完全达标的快照 */
const compliant: DutyPrefsSnapshot = {
  ...toSnapshot(createInitialState()),
  language: 'English',
  theme: '深色',
  timeBasis: 'UTC',
  alarms: { flight: true, notice: false, weather: false, passenger: false, promo: false },
  quietStart: '02:00',
  quietEnd: '05:30',
  reportFreq: '每周一',
  verifyPassed: true,
  terminalSites: ['广州白云', '北京大兴', '成都天府'],
  labEnabled: true,
  smartRelease: true,
  saved: true,
  loadedLogDates: ['09-28', '09-16', '09-02', '08-30'],
}

function resultOf(items: ReturnType<typeof auditDutyPreferences>, key: string) {
  const item = items.find((entry) => entry.key === key)
  expect(item, `判定项 ${key} 应存在`).toBeDefined()
  return item!.result
}

describe('auditDutyPreferences', () => {
  it('完整达标快照全部通过（09-02 已加载为 ok 而非 pending）', () => {
    const items = auditDutyPreferences(compliant)
    expect(items.filter((item) => item.result !== 'ok')).toEqual([])
    expect(items.map((item) => item.key)).toEqual([
      'language',
      'theme',
      'time-basis',
      'notify',
      'quiet-window',
      'report-frequency',
      'security-verify',
      'terminal-shanghai',
      'smart-release',
      'audit-log-0902',
      'saved',
    ])
  })

  it('初始快照：可判项全部 miss，09-02 流水未加载为 pending', () => {
    const items = auditDutyPreferences(toSnapshot(createInitialState()))
    for (const key of [
      'language',
      'theme',
      'time-basis',
      'notify',
      'quiet-window',
      'report-frequency',
      'security-verify',
      'terminal-shanghai',
      'smart-release',
      'saved',
    ]) {
      expect(resultOf(items, key)).toBe('miss')
    }
    expect(resultOf(items, 'audit-log-0902')).toBe('pending')
  })

  it('通知多开任一渠道即失败，全关但航班动态也关同样失败', () => {
    const extraOn = auditDutyPreferences({ ...compliant, alarms: { ...compliant.alarms, promo: true } })
    expect(resultOf(extraOn, 'notify')).toBe('miss')

    const allOff = auditDutyPreferences({
      ...compliant,
      alarms: { flight: false, notice: false, weather: false, passenger: false, promo: false },
    })
    expect(resultOf(allOff, 'notify')).toBe('miss')
  })

  it('静默窗口起止任一不符即失败', () => {
    const wrongStart = auditDutyPreferences({ ...compliant, quietStart: '02:30' })
    expect(resultOf(wrongStart, 'quiet-window')).toBe('miss')

    const wrongEnd = auditDutyPreferences({ ...compliant, quietEnd: '05:00' })
    expect(resultOf(wrongEnd, 'quiet-window')).toBe('miss')
  })

  it('安全验证未通过或实验特性未启用时对应判定失败', () => {
    const noVerify = auditDutyPreferences({ ...compliant, verifyPassed: false })
    expect(resultOf(noVerify, 'security-verify')).toBe('miss')

    const labOff = auditDutyPreferences({ ...compliant, labEnabled: false })
    expect(resultOf(labOff, 'smart-release')).toBe('miss')

    const toggleOff = auditDutyPreferences({ ...compliant, smartRelease: false })
    expect(resultOf(toggleOff, 'smart-release')).toBe('miss')
  })

  it('上海终端仍在列表时失败，仅剩其他站点时通过', () => {
    const stillOnline = auditDutyPreferences({
      ...compliant,
      terminalSites: ['广州白云', '上海虹桥', '北京大兴'],
    })
    expect(resultOf(stillOnline, 'terminal-shanghai')).toBe('miss')

    const offline = auditDutyPreferences({
      ...compliant,
      terminalSites: ['广州白云', '北京大兴', '成都天府'],
    })
    expect(resultOf(offline, 'terminal-shanghai')).toBe('ok')
  })

  it('未保存或 09-02 流水未加载时对应判定不通过', () => {
    const unsaved = auditDutyPreferences({ ...compliant, saved: false })
    expect(resultOf(unsaved, 'saved')).toBe('miss')

    const notLoaded = auditDutyPreferences({ ...compliant, loadedLogDates: ['09-28', '09-16'] })
    expect(resultOf(notLoaded, 'audit-log-0902')).toBe('pending')
  })
})
