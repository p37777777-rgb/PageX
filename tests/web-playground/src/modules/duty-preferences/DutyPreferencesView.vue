<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Bell,
  CaretBottom,
  Clock,
  Cpu,
  Lock,
  MagicStick,
  Monitor,
} from '@element-plus/icons-vue'
import { useModuleProbe } from '../../probe'
import { auditDutyPreferences } from './audit'
import {
  auditLogPool,
  clearStoredSettings,
  createInitialState,
  LANGUAGE_OPTIONS,
  LOADED_PAGE_SIZE,
  persistSettings,
  REPORT_FREQ_OPTIONS,
  restoreSettings,
  THEME_OPTIONS,
  TIME_BASIS_OPTIONS,
  toSnapshot,
  type AlarmChannels,
} from './state'

/** 值班身份复核的动态口令（通过平台消息下发） */
const PASSCODE = '730481'

const state = reactive(createInitialState())

/* ---------- 左侧锚点导航 ---------- */
const navGroups = [
  { id: 'sec-display', label: '显示与语言', icon: Monitor },
  { id: 'sec-alarm', label: '告警通知', icon: Bell },
  { id: 'sec-security', label: '账号安全', icon: Lock },
  { id: 'sec-terminal', label: '值勤终端', icon: Cpu },
  { id: 'sec-lab', label: '实验特性', icon: MagicStick },
  { id: 'sec-audit', label: '操作流水', icon: Clock },
]
const activeSection = ref('sec-display')

function jumpTo(id: string) {
  activeSection.value = id
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/* ---------- 显示与语言 ---------- */
function toggleLangMenu() {
  state.langMenuOpen = !state.langMenuOpen
}
function pickLanguage(value: string) {
  state.language = value
  state.langMenuOpen = false
}
function toggleThemeMenu() {
  state.themeMenuOpen = !state.themeMenuOpen
}
function pickTheme(value: string) {
  state.theme = value
  state.themeMenuOpen = false
}
function toggleTimePanel() {
  state.timePanelOpen = !state.timePanelOpen
}
function pickTimeBasis(value: string) {
  state.timeBasis = value
  state.timePanelOpen = false
}

/* ---------- 告警通知 ---------- */
const alarmRows: Array<{ key: keyof AlarmChannels; name: string; desc: string }> = [
  { key: 'flight', name: '航班动态', desc: '航班计划变更、延误与取消即时提醒' },
  { key: 'notice', name: '系统公告', desc: '平台版本发布与例行维护通知' },
  { key: 'weather', name: '气象预警', desc: '机场雷雨、大风与低能见度预警' },
  { key: 'passenger', name: '旅客服务', desc: '特殊旅客保障与客服工单提醒' },
  { key: 'promo', name: '合作推广', desc: '航司联合活动与合作推广信息' },
]

function toggleAdvanced() {
  state.advancedOpen = !state.advancedOpen
}

/* ---------- 账号安全 ---------- */
let countdownTimer: number | undefined
let verifyTimer: number | undefined

function sendPasscode() {
  if (state.countdown > 0) return
  state.countdown = 60
  ElMessage.success(`动态口令已下发至值班手机：${PASSCODE}`)
  countdownTimer = window.setInterval(() => {
    state.countdown -= 1
    if (state.countdown <= 0 && countdownTimer) {
      window.clearInterval(countdownTimer)
      countdownTimer = undefined
    }
  }, 1000)
}

function submitVerify() {
  if (state.verifying || !state.codeInput) return
  state.verifying = true
  verifyTimer = window.setTimeout(() => {
    state.verifying = false
    state.verifyState = state.codeInput === PASSCODE ? 'ok' : 'error'
  }, 1200)
}

/* ---------- 值勤终端 ---------- */
function offlineTerminal(id: number) {
  const target = state.terminals.find((terminal) => terminal.id === id)
  state.terminals = state.terminals.filter((terminal) => terminal.id !== id)
  if (target) ElMessage.success(`「${target.site} · ${target.code}」已下线`)
}

/* ---------- 实验特性 ---------- */
const labRows: Array<{ key: keyof typeof state.labs; name: string; desc: string }> = [
  { key: 'smartRelease', name: '智能放轮', desc: '着陆滑行结束后自动释放停留刹车' },
  { key: 'handoverDigest', name: '交接班自动摘要', desc: '按席位自动生成交接班事项摘要' },
]

function enableLab() {
  if (state.labEnabled) return
  state.labEnabled = true
  ElMessage.success('实验特性已启用')
}

/* ---------- 操作流水 ---------- */
const suggestOptions = ['席位签入 / 签出', '告警规则变更', '口令重置', '终端绑定', '视图权限']

function applySuggest(value: string) {
  state.auditKeyword = value
  state.suggestOpen = false
}

const visibleLogs = computed(() => auditLogPool.slice(0, state.loadedLogCount))
const allLogsLoaded = computed(() => state.loadedLogCount >= auditLogPool.length)

const logSentinel = ref<HTMLElement>()
let logObserver: IntersectionObserver | undefined

onMounted(() => {
  restoreSettings(state)
  logObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !allLogsLoaded.value) {
        state.loadedLogCount = Math.min(
          state.loadedLogCount + LOADED_PAGE_SIZE,
          auditLogPool.length,
        )
      }
    },
    { rootMargin: '120px' },
  )
  if (logSentinel.value) logObserver.observe(logSentinel.value)
})

/* ---------- 保存 ---------- */
function saveSettings() {
  state.saved = true
  state.receiptNo = `DP-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Date.now() % 10000}`
  persistSettings(state)
  ElMessage.success('偏好设置已保存')
}

/* ---------- 探针 ---------- */
function resetModule() {
  if (countdownTimer) window.clearInterval(countdownTimer)
  if (verifyTimer) window.clearTimeout(verifyTimer)
  countdownTimer = undefined
  verifyTimer = undefined
  clearStoredSettings()
  Object.assign(state, createInitialState())
}

useModuleProbe('duty-prefs', {
  runChecks: () => auditDutyPreferences(toSnapshot(state)),
  resetModule,
})

onBeforeUnmount(() => {
  if (countdownTimer) window.clearInterval(countdownTimer)
  if (verifyTimer) window.clearTimeout(verifyTimer)
  logObserver?.disconnect()
})
</script>

<template>
  <div class="dp-page">
    <header class="dp-header">
      <div>
        <h1 class="dp-title">个人工作台设置</h1>
        <p class="dp-subtitle">签派席 · 值班偏好与账号安全</p>
      </div>
    </header>

    <div class="dp-body">
      <aside class="dp-nav">
        <button
          v-for="group in navGroups"
          :key="group.id"
          type="button"
          class="dp-nav-item"
          :class="{ active: activeSection === group.id }"
          @click="jumpTo(group.id)"
        >
          <el-icon class="dp-nav-icon"><component :is="group.icon" /></el-icon>
          <span>{{ group.label }}</span>
        </button>
      </aside>

      <main class="dp-main">
        <!-- 显示与语言 -->
        <section id="sec-display" class="dp-section">
          <div class="dp-section-head">
            <el-icon class="dp-section-icon"><Monitor /></el-icon>
            <div>
              <h2 class="dp-section-title">显示与语言</h2>
              <p class="dp-section-desc">界面语言、外观主题与运行时钟基准</p>
            </div>
          </div>

          <div class="dp-card">
            <div class="dp-field">
              <span class="dp-field-label">界面显示语言</span>
              <button
                type="button"
                class="dp-select-trigger"
                :aria-expanded="state.langMenuOpen"
                @click="toggleLangMenu"
              >
                <span>{{ state.language }}</span>
                <el-icon class="dp-caret"><CaretBottom /></el-icon>
              </button>
              <div class="dp-lang-menu" :class="{ open: state.langMenuOpen }" role="listbox" aria-label="界面显示语言">
                <button
                  v-for="option in LANGUAGE_OPTIONS"
                  :key="option"
                  type="button"
                  role="option"
                  class="dp-menu-option"
                  :aria-selected="option === state.language"
                  @click="pickLanguage(option)"
                >
                  {{ option }}
                </button>
              </div>
            </div>

            <div class="dp-field">
              <span class="dp-field-label">工作台外观</span>
              <button
                type="button"
                class="dp-select-trigger"
                :aria-expanded="state.themeMenuOpen"
                @click="toggleThemeMenu"
              >
                <span>{{ state.theme }}</span>
                <el-icon class="dp-caret"><CaretBottom /></el-icon>
              </button>
              <div class="dp-theme-menu" :class="{ open: state.themeMenuOpen }" role="listbox" aria-label="工作台外观">
                <button
                  v-for="option in THEME_OPTIONS"
                  :key="option"
                  type="button"
                  role="option"
                  class="dp-menu-option"
                  :aria-selected="option === state.theme"
                  @click="pickTheme(option)"
                >
                  {{ option }}
                </button>
              </div>
            </div>

            <div class="dp-field">
              <span class="dp-field-label">时间基准</span>
              <button
                type="button"
                class="dp-select-trigger"
                :aria-expanded="state.timePanelOpen"
                @click="toggleTimePanel"
              >
                <span>{{ state.timeBasis }}</span>
                <el-icon class="dp-caret" :class="{ flipped: state.timePanelOpen }"><CaretBottom /></el-icon>
              </button>
            </div>
            <div class="dp-time-panel" :class="{ open: state.timePanelOpen }" role="listbox" aria-label="时间基准">
              <div class="dp-time-list">
                <button
                  v-for="option in TIME_BASIS_OPTIONS"
                  :key="option"
                  type="button"
                  role="option"
                  class="dp-menu-option boxed"
                  :aria-selected="option === state.timeBasis"
                  @click="pickTimeBasis(option)"
                >
                  {{ option }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- 告警通知 -->
        <section id="sec-alarm" class="dp-section">
          <div class="dp-section-head">
            <el-icon class="dp-section-icon"><Bell /></el-icon>
            <div>
              <h2 class="dp-section-title">告警通知</h2>
              <p class="dp-section-desc">运行告警的接收渠道与免打扰规则</p>
            </div>
          </div>

          <div class="dp-card">
            <div class="dp-alarm-list">
              <label v-for="row in alarmRows" :key="row.key" class="dp-alarm-row">
                <input v-model="state.alarms[row.key]" type="checkbox" class="dp-alarm-box" />
                <span class="dp-alarm-track" aria-hidden="true"></span>
                <span class="dp-alarm-text">
                  <span class="dp-alarm-name">{{ row.name }}</span>
                  <span class="dp-alarm-desc">{{ row.desc }}</span>
                </span>
              </label>
            </div>

            <button type="button" class="dp-adv-toggle" :aria-expanded="state.advancedOpen" @click="toggleAdvanced">
              <span>高级免打扰规则</span>
              <el-icon class="dp-caret" :class="{ flipped: state.advancedOpen }"><CaretBottom /></el-icon>
            </button>
            <div class="dp-adv-panel" :class="{ open: state.advancedOpen }">
              <div class="dp-adv-body">
                <div class="dp-adv-field">
                  <span class="dp-field-label">静默窗口</span>
                  <div class="dp-quiet-range">
                    <el-time-select
                      v-model="state.quietStart"
                      class="dp-time-select"
                      start="00:00"
                      step="00:30"
                      end="08:00"
                      placeholder="开始"
                      aria-label="静默开始时间"
                    />
                    <span class="dp-quiet-sep">至</span>
                    <el-time-select
                      v-model="state.quietEnd"
                      class="dp-time-select"
                      start="00:00"
                      step="00:30"
                      end="08:00"
                      placeholder="结束"
                      aria-label="静默结束时间"
                    />
                  </div>
                </div>
                <div class="dp-adv-field">
                  <span class="dp-field-label">运行日报推送频率</span>
                  <el-radio-group v-model="state.reportFreq">
                    <el-radio-button v-for="freq in REPORT_FREQ_OPTIONS" :key="freq" :value="freq">
                      {{ freq }}
                    </el-radio-button>
                  </el-radio-group>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 账号安全 -->
        <section id="sec-security" class="dp-section">
          <div class="dp-section-head">
            <el-icon class="dp-section-icon"><Lock /></el-icon>
            <div>
              <h2 class="dp-section-title">账号安全</h2>
              <p class="dp-section-desc">修改敏感偏好前需完成一次值班身份复核</p>
            </div>
          </div>

          <div class="dp-card">
            <div class="dp-verify-row">
              <button type="button" class="dp-btn" :disabled="state.countdown > 0" @click="sendPasscode">
                {{ state.countdown > 0 ? `重新获取（${state.countdown}s）` : '发送动态口令' }}
              </button>
              <el-input
                v-model="state.codeInput"
                class="dp-code-input"
                maxlength="6"
                placeholder="6 位动态口令"
                aria-label="动态口令"
              />
              <button
                type="button"
                class="dp-btn primary"
                :disabled="state.verifying || !state.codeInput"
                @click="submitVerify"
              >
                {{ state.verifying ? '复核中…' : '提交复核' }}
              </button>
            </div>
            <div
              class="dp-verify-strip"
              :class="{
                show: state.verifyState !== 'idle',
                pass: state.verifyState === 'ok',
                reject: state.verifyState === 'error',
              }"
              role="status"
            >
              <span v-if="state.verifyState === 'ok'">身份复核通过，本次会话已信任该操作</span>
              <span v-else-if="state.verifyState === 'error'">动态口令不正确，请重新输入</span>
            </div>
          </div>
        </section>

        <!-- 值勤终端 -->
        <section id="sec-terminal" class="dp-section">
          <div class="dp-section-head">
            <el-icon class="dp-section-icon"><Cpu /></el-icon>
            <div>
              <h2 class="dp-section-title">值勤终端</h2>
              <p class="dp-section-desc">绑定签派席位的登录终端，长期不用的可远程下线</p>
            </div>
          </div>

          <div class="dp-card">
            <div class="dp-terminal-list">
              <div v-for="terminal in state.terminals" :key="terminal.id" class="dp-terminal-row">
                <div class="dp-terminal-info">
                  <span class="dp-terminal-site">{{ terminal.site }} · {{ terminal.code }}</span>
                  <span class="dp-terminal-meta">最近活跃：{{ terminal.lastActive }}</span>
                </div>
                <el-tag v-if="terminal.current" size="small" type="success" effect="light">当前席位</el-tag>
                <button v-else type="button" class="dp-t-offline" @click="offlineTerminal(terminal.id)">
                  下线
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- 实验特性 -->
        <section id="sec-lab" class="dp-section">
          <div class="dp-section-head">
            <el-icon class="dp-section-icon"><MagicStick /></el-icon>
            <div>
              <h2 class="dp-section-title">实验特性</h2>
              <p class="dp-section-desc">灰度中的运行辅助能力，启用前请确认风险须知</p>
            </div>
          </div>

          <div class="dp-card">
            <el-checkbox v-model="state.riskChecked" class="dp-risk-check">
              我已阅读《实验功能风险确认》，知悉实验特性可能影响放行画面输出
            </el-checkbox>
            <div class="dp-lab-actions">
              <button
                type="button"
                class="dp-btn primary"
                :disabled="!state.riskChecked || state.labEnabled"
                @click="enableLab"
              >
                {{ state.labEnabled ? '实验特性已启用' : '启用实验特性' }}
              </button>
            </div>
            <div v-show="state.labEnabled" class="dp-lab-panel">
              <div class="dp-alarm-list">
                <label v-for="row in labRows" :key="row.key" class="dp-alarm-row">
                  <input v-model="state.labs[row.key]" type="checkbox" class="dp-alarm-box" />
                  <span class="dp-alarm-track" aria-hidden="true"></span>
                  <span class="dp-alarm-text">
                    <span class="dp-alarm-name">{{ row.name }}</span>
                    <span class="dp-alarm-desc">{{ row.desc }}</span>
                  </span>
                </label>
              </div>
            </div>
          </div>
        </section>

        <!-- 操作流水 -->
        <section id="sec-audit" class="dp-section">
          <div class="dp-section-head">
            <el-icon class="dp-section-icon"><Clock /></el-icon>
            <div>
              <h2 class="dp-section-title">账号操作流水</h2>
              <p class="dp-section-desc">近 60 天账号操作留痕，滚动加载更多</p>
            </div>
          </div>

          <div class="dp-card">
            <div class="dp-audit-search">
              <input
                v-model="state.auditKeyword"
                class="dp-audit-input"
                placeholder="检索操作类型、终端或流水号"
                aria-label="检索账号操作流水"
                @focus="state.suggestOpen = true"
                @blur="state.suggestOpen = false"
              />
              <div class="dp-audit-suggest" :class="{ open: state.suggestOpen }" role="listbox" aria-label="检索建议">
                <button
                  v-for="option in suggestOptions"
                  :key="option"
                  type="button"
                  role="option"
                  class="dp-menu-option"
                  @mousedown.prevent
                  @click="applySuggest(option)"
                >
                  {{ option }}
                </button>
              </div>
            </div>

            <ul class="dp-log-list">
              <li v-for="entry in visibleLogs" :key="entry.date + entry.time" class="dp-log-item">
                <span class="dp-log-date">{{ entry.date }}</span>
                <span class="dp-log-time">{{ entry.time }}</span>
                <span class="dp-log-text">{{ entry.text }}</span>
              </li>
            </ul>
            <div ref="logSentinel" class="dp-log-sentinel">
              {{ allLogsLoaded ? '已加载全部流水' : '滚动加载更多…' }}
            </div>
          </div>
        </section>

        <!-- 保存 -->
        <footer class="dp-footer">
          <div v-if="state.saved" class="dp-receipt" role="status">
            设置已保存 · 回执号 {{ state.receiptNo }}
          </div>
          <button type="button" class="dp-btn primary large" @click="saveSettings">保存设置</button>
        </footer>
      </main>
    </div>
  </div>
</template>

<style scoped>
.dp-page {
  max-width: 1080px;
  margin-inline: auto;
  color: #1f2d3d;
}

.dp-header {
  padding: 20px 4px 14px;
}

.dp-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.dp-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: #7a8b99;
}

.dp-body {
  display: flex;
  align-items: flex-start;
  gap: 20px;
}

/* 左侧锚点导航 */
.dp-nav {
  position: sticky;
  top: 16px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 168px;
  padding: 10px;
  background: #ffffff;
  border: 1px solid #e3ebf0;
  border-radius: 12px;
}

.dp-nav-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #4c5f6e;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.dp-nav-item:hover {
  background: #f0f7f9;
}

.dp-nav-item.active {
  background: #e5f4f8;
  color: #0e7490;
  font-weight: 600;
}

.dp-nav-icon {
  color: inherit;
}

.dp-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-bottom: 28px;
}

.dp-section {
  scroll-margin-top: 16px;
}

.dp-section-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  padding-inline: 4px;
}

.dp-section-icon {
  color: #0e7490;
  font-size: 18px;
}

.dp-section-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.dp-section-desc {
  margin: 2px 0 0;
  font-size: 12px;
  color: #7a8b99;
}

.dp-card {
  background: #ffffff;
  border: 1px solid #e3ebf0;
  border-radius: 12px;
  padding: 18px 20px;
}

/* ---------- 显示与语言 ---------- */
.dp-field {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 320px;
}

.dp-field + .dp-field {
  margin-top: 16px;
}

.dp-field-label {
  font-size: 13px;
  color: #5b6d7c;
}

.dp-select-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #cfdce4;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2d3d;
  font-size: 14px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.dp-select-trigger:hover {
  border-color: #0e7490;
}

.dp-caret {
  color: #8aa0ae;
  transition: transform 0.2s;
}

.dp-caret.flipped {
  transform: rotate(180deg);
}

.dp-menu-option {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #1f2d3d;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.dp-menu-option:hover {
  background: #f0f7f9;
  color: #0e7490;
}

/* 隐蔽手法 1：opacity + pointer-events，DOM 常驻，class 切换 */
.dp-lang-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 30;
  padding: 6px;
  background: #ffffff;
  border: 1px solid #dbe6ec;
  border-radius: 10px;
  box-shadow: 0 10px 24px rgba(15, 55, 70, 0.12);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
}

.dp-lang-menu.open {
  opacity: 1;
  pointer-events: auto;
}

/* 隐蔽手法 2：visibility，DOM 常驻 */
.dp-theme-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 30;
  padding: 6px;
  background: #ffffff;
  border: 1px solid #dbe6ec;
  border-radius: 10px;
  box-shadow: 0 10px 24px rgba(15, 55, 70, 0.12);
  visibility: hidden;
}

.dp-theme-menu.open {
  visibility: visible;
}

/* 隐蔽手法 3：max-height 折叠的时间基准面板 */
.dp-time-panel {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.25s ease;
}

.dp-time-panel.open {
  max-height: 220px;
}

.dp-time-list {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 110px));
  gap: 8px;
}

.dp-menu-option.boxed {
  border: 1px solid #cfdce4;
  border-radius: 8px;
  text-align: center;
  padding: 7px 10px;
}

/* ---------- 告警通知：隐形 checkbox 开关 ---------- */
.dp-alarm-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dp-alarm-row {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  width: fit-content;
  cursor: pointer;
}

/* 隐蔽手法 4：checkbox 本体透明且尺寸 0，仅 label 可见 */
.dp-alarm-box {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
}

.dp-alarm-track {
  position: relative;
  flex: none;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: #c9d6de;
  transition: background-color 0.2s;
}

.dp-alarm-track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s;
}

.dp-alarm-box:checked + .dp-alarm-track {
  background: #0e7490;
}

.dp-alarm-box:checked + .dp-alarm-track::after {
  transform: translateX(18px);
}

.dp-alarm-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dp-alarm-name {
  font-size: 14px;
}

.dp-alarm-desc {
  font-size: 12px;
  color: #7a8b99;
}

/* 隐蔽手法 5：max-height 折叠 + aria-expanded 的高级规则面板 */
.dp-adv-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 18px;
  padding: 0;
  border: none;
  background: none;
  color: #0e7490;
  font-size: 13px;
  cursor: pointer;
}

.dp-adv-panel {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.25s ease;
}

.dp-adv-panel.open {
  max-height: 240px;
}

.dp-adv-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 0 4px;
}

.dp-adv-field {
  display: flex;
  align-items: center;
  gap: 16px;
}

.dp-quiet-range {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dp-time-select {
  width: 128px;
}

.dp-quiet-sep {
  font-size: 13px;
  color: #7a8b99;
}

/* ---------- 账号安全 ---------- */
.dp-verify-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.dp-btn {
  padding: 8px 18px;
  border: 1px solid #cfdce4;
  border-radius: 8px;
  background: #ffffff;
  color: #1f2d3d;
  font-size: 14px;
  cursor: pointer;
  transition: border-color 0.2s, opacity 0.2s;
}

.dp-btn:hover:not(:disabled) {
  border-color: #0e7490;
  color: #0e7490;
}

.dp-btn.primary {
  border-color: #0e7490;
  background: #0e7490;
  color: #ffffff;
}

.dp-btn.primary:hover:not(:disabled) {
  background: #0c6781;
  color: #ffffff;
}

.dp-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.dp-btn.large {
  padding: 10px 34px;
  font-size: 15px;
}

.dp-code-input {
  width: 170px;
}

/* 隐蔽手法 6：opacity + translateY，验证后 1.2s 延迟淡入 */
.dp-verify-strip {
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  opacity: 0;
  transform: translateY(-8px);
  pointer-events: none;
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.dp-verify-strip.show {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}

.dp-verify-strip.pass {
  background: #e8f7f1;
  color: #0d8a5f;
}

.dp-verify-strip.reject {
  background: #fdeeee;
  color: #c45656;
}

/* ---------- 值勤终端 ---------- */
.dp-terminal-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dp-terminal-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  transition: background-color 0.15s;
}

.dp-terminal-row:hover {
  background: #f0f7f9;
}

.dp-terminal-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dp-terminal-site {
  font-size: 14px;
}

.dp-terminal-meta {
  font-size: 12px;
  color: #7a8b99;
}

/* 隐蔽手法 7：行内按钮 opacity:0，仅 hover 该行时出现 */
.dp-t-offline {
  padding: 4px 14px;
  border: 1px solid #f2c4c4;
  border-radius: 6px;
  background: transparent;
  color: #c45656;
  font-size: 12px;
  opacity: 0;
  pointer-events: none;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.dp-terminal-row:hover .dp-t-offline {
  opacity: 1;
  pointer-events: auto;
}

.dp-terminal-row:hover .dp-t-offline:hover {
  background: #fdeeee;
}

/* ---------- 实验特性 ---------- */
.dp-risk-check {
  font-size: 13px;
}

.dp-lab-actions {
  margin-top: 12px;
}

/* 隐蔽手法 11：v-show（display:none），启用后出现 */
.dp-lab-panel {
  margin-top: 16px;
  padding: 16px;
  border-radius: 10px;
  background: #f4f9fb;
}

/* ---------- 操作流水 ---------- */
.dp-audit-search {
  position: relative;
  margin-bottom: 14px;
}

.dp-audit-input {
  width: 340px;
  max-width: 100%;
  padding: 8px 12px;
  border: 1px solid #cfdce4;
  border-radius: 8px;
  font-size: 14px;
  color: #1f2d3d;
}

.dp-audit-input:focus {
  outline: none;
  border-color: #0e7490;
}

/* 隐蔽手法 9：opacity + visibility，聚焦后出现 */
.dp-audit-suggest {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 30;
  min-width: 260px;
  padding: 6px;
  background: #ffffff;
  border: 1px solid #dbe6ec;
  border-radius: 10px;
  box-shadow: 0 10px 24px rgba(15, 55, 70, 0.12);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.18s ease;
}

.dp-audit-suggest.open {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

.dp-log-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.dp-log-item {
  display: flex;
  align-items: baseline;
  gap: 14px;
  padding: 9px 4px;
  border-bottom: 1px dashed #e3ebf0;
  font-size: 13px;
}

.dp-log-item:last-child {
  border-bottom: none;
}

.dp-log-date,
.dp-log-time {
  flex: none;
  color: #7a8b99;
  font-variant-numeric: tabular-nums;
}

.dp-log-text {
  color: #1f2d3d;
}

.dp-log-sentinel {
  padding: 16px 0 4px;
  text-align: center;
  font-size: 13px;
  color: #8aa0ae;
}

/* ---------- 保存 ---------- */
.dp-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  padding: 4px;
}

.dp-receipt {
  padding: 8px 14px;
  border-radius: 8px;
  background: #e8f7f1;
  color: #0d8a5f;
  font-size: 13px;
}
</style>
