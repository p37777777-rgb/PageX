/*
 * 值勤偏好模块的数据层：
 * - 类型与初始状态工厂（resetModule 用 Object.assign 整体回滚）
 * - 页面终态快照构建（供纯判定函数消费）
 * - 自管 localStorage 键的持久化 / 恢复 / 清除
 * - 账号操作流水数据池（懒加载分页用）
 */

export interface AlarmChannels {
  /** 航班动态 */
  flight: boolean
  /** 系统公告 */
  notice: boolean
  /** 气象预警 */
  weather: boolean
  /** 旅客服务 */
  passenger: boolean
  /** 合作推广 */
  promo: boolean
}

export interface TerminalUnit {
  id: number
  /** 所在机场 site，如「上海虹桥」 */
  site: string
  /** 终端编号 */
  code: string
  lastActive: string
  /** 是否为当前席位 */
  current: boolean
}

export interface LabFeatures {
  /** 智能放轮 */
  smartRelease: boolean
  /** 自动交接班摘要 */
  handoverDigest: boolean
}

export type VerifyState = 'idle' | 'ok' | 'error'

export interface DutyPrefsState {
  /* 显示与语言 */
  language: string
  theme: string
  timeBasis: string
  langMenuOpen: boolean
  themeMenuOpen: boolean
  timePanelOpen: boolean

  /* 告警通知 */
  alarms: AlarmChannels
  advancedOpen: boolean
  quietStart: string
  quietEnd: string
  reportFreq: string

  /* 账号安全 */
  codeInput: string
  countdown: number
  verifying: boolean
  verifyState: VerifyState

  /* 值勤终端 */
  terminals: TerminalUnit[]

  /* 操作流水 */
  auditKeyword: string
  suggestOpen: boolean
  loadedLogCount: number

  /* 实验特性 */
  riskChecked: boolean
  labEnabled: boolean
  labs: LabFeatures

  /* 保存回执 */
  saved: boolean
  receiptNo: string
}

/** 判定函数消费的只读快照 */
export interface DutyPrefsSnapshot {
  language: string
  theme: string
  timeBasis: string
  alarms: AlarmChannels
  quietStart: string
  quietEnd: string
  reportFreq: string
  verifyPassed: boolean
  terminalSites: string[]
  labEnabled: boolean
  smartRelease: boolean
  saved: boolean
  loadedLogDates: string[]
}

export const LANGUAGE_OPTIONS = ['简体中文', 'English', '日本語'] as const
export const THEME_OPTIONS = ['浅色', '深色', '跟随系统'] as const
export const TIME_BASIS_OPTIONS = ['本地时间', 'UTC', '东京'] as const
export const REPORT_FREQ_OPTIONS = ['每日', '每周一', '每周五'] as const

export const LOADED_PAGE_SIZE = 8

export function createInitialState(): DutyPrefsState {
  return {
    language: '简体中文',
    theme: '浅色',
    timeBasis: '本地时间',
    langMenuOpen: false,
    themeMenuOpen: false,
    timePanelOpen: false,

    alarms: {
      flight: true,
      notice: true,
      weather: true,
      passenger: true,
      promo: false,
    },
    advancedOpen: false,
    quietStart: '22:30',
    quietEnd: '05:00',
    reportFreq: '每日',

    codeInput: '',
    countdown: 0,
    verifying: false,
    verifyState: 'idle',

    terminals: [
      { id: 1, site: '广州白云', code: 'CAN-D02', lastActive: '当前在线', current: true },
      { id: 2, site: '上海虹桥', code: 'SHA-A11', lastActive: '09-13 18:40', current: false },
      { id: 3, site: '北京大兴', code: 'PKX-C03', lastActive: '09-19 07:55', current: false },
      { id: 4, site: '成都天府', code: 'TFU-F07', lastActive: '09-21 22:10', current: false },
    ],

    auditKeyword: '',
    suggestOpen: false,
    loadedLogCount: LOADED_PAGE_SIZE,

    riskChecked: false,
    labEnabled: false,
    labs: {
      smartRelease: false,
      handoverDigest: false,
    },

    saved: false,
    receiptNo: '',
  }
}

/** 从响应式状态抽取只读快照（判定入口调用） */
export function toSnapshot(state: DutyPrefsState): DutyPrefsSnapshot {
  return {
    language: state.language,
    theme: state.theme,
    timeBasis: state.timeBasis,
    alarms: { ...state.alarms },
    quietStart: state.quietStart,
    quietEnd: state.quietEnd,
    reportFreq: state.reportFreq,
    verifyPassed: state.verifyState === 'ok',
    terminalSites: state.terminals.map((terminal) => terminal.site),
    labEnabled: state.labEnabled,
    smartRelease: state.labs.smartRelease,
    saved: state.saved,
    loadedLogDates: auditLogPool
      .slice(0, state.loadedLogCount)
      .map((entry) => entry.date),
  }
}

/* ---------- 操作流水数据池（按时间倒序，09-02 记录位于第 3 页之后） ---------- */

export interface AuditLogEntry {
  date: string
  time: string
  text: string
}

export const auditLogPool: AuditLogEntry[] = [
  { date: '09-28', time: '08:12', text: '调整了告警静默时段' },
  { date: '09-27', time: '16:03', text: '导出了冬春航季签派放行清单' },
  { date: '09-26', time: '09:40', text: '在北京大兴终端签入' },
  { date: '09-24', time: '20:11', text: '修改了告警通知渠道' },
  { date: '09-22', time: '11:26', text: '更新了值勤交接班模板' },
  { date: '09-21', time: '22:10', text: '在成都天府终端签入' },
  { date: '09-19', time: '07:55', text: '在北京大兴终端签入' },
  { date: '09-18', time: '14:32', text: '订阅了气象预警推送' },
  { date: '09-16', time: '10:05', text: '调整了运行日报推送频率' },
  { date: '09-15', time: '09:18', text: '申请了放行监控视图权限' },
  { date: '09-13', time: '18:40', text: '在上海虹桥终端签入' },
  { date: '09-12', time: '08:44', text: '更新了应急联络卡' },
  { date: '09-10', time: '17:29', text: '导出了周度告警统计' },
  { date: '09-08', time: '12:06', text: '修改了值勤终端绑定' },
  { date: '09-06', time: '15:53', text: '开启了双因素认证' },
  { date: '09-05', time: '10:37', text: '更新了紧急联系人与升级链路' },
  { date: '09-02', time: '21:47', text: '重置了值班动态口令' },
  { date: '09-02', time: '09:15', text: '在上海虹桥终端签入' },
  { date: '08-30', time: '19:22', text: '调整了席位偏好布局' },
  { date: '08-28', time: '08:31', text: '导出了月度签派日志' },
  { date: '08-26', time: '16:49', text: '关闭了合作推广通知' },
  { date: '08-24', time: '11:03', text: '在广州白云终端签入' },
  { date: '08-22', time: '09:57', text: '更新了签派资质证照' },
  { date: '08-20', time: '14:15', text: '修改了平台登录密码' },
  { date: '08-18', time: '10:26', text: '完成了年度应急演练登记' },
]

/* ---------- 自管 localStorage 键 ---------- */

const STORAGE_KEY = 'lingyue.duty-prefs.v1'

interface StoredSettings {
  language: string
  theme: string
  timeBasis: string
  alarms: AlarmChannels
  quietStart: string
  quietEnd: string
  reportFreq: string
  labEnabled: boolean
  labs: LabFeatures
}

/** 保存设置时把关键偏好写入 localStorage（模拟真实设置中心行为） */
export function persistSettings(state: DutyPrefsState): void {
  const payload: StoredSettings = {
    language: state.language,
    theme: state.theme,
    timeBasis: state.timeBasis,
    alarms: { ...state.alarms },
    quietStart: state.quietStart,
    quietEnd: state.quietEnd,
    reportFreq: state.reportFreq,
    labEnabled: state.labEnabled,
    labs: { ...state.labs },
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* 存储不可用时静默降级 */
  }
}

/** 挂载时恢复上次保存的偏好 */
export function restoreSettings(state: DutyPrefsState): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const stored = JSON.parse(raw) as Partial<StoredSettings>
    if (stored.language) state.language = stored.language
    if (stored.theme) state.theme = stored.theme
    if (stored.timeBasis) state.timeBasis = stored.timeBasis
    if (stored.alarms) Object.assign(state.alarms, stored.alarms)
    if (stored.quietStart) state.quietStart = stored.quietStart
    if (stored.quietEnd) state.quietEnd = stored.quietEnd
    if (stored.reportFreq) state.reportFreq = stored.reportFreq
    if (typeof stored.labEnabled === 'boolean') state.labEnabled = stored.labEnabled
    if (stored.labs) Object.assign(state.labs, stored.labs)
  } catch {
    /* 数据损坏时忽略，保持初始状态 */
  }
}

/** 模块重置时清除自建键 */
export function clearStoredSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 忽略 */
  }
}
