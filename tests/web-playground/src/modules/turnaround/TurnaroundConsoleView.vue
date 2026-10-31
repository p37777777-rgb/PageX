<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  CircleCheckFilled,
  CircleCloseFilled,
  Delete,
  Loading,
  Plus,
  Promotion,
  RefreshRight,
  Timer,
  WarningFilled,
} from '@element-plus/icons-vue'
import { useModuleProbe } from '../../probe'
import {
  failedFlightPatch,
  initialFlights,
  initialGateWeights,
  initialSavedConfigs,
  sopPlans,
  succeededFlightPatch,
} from './data'
import {
  buildRunScript,
  VENDOR_FATAL_SNIPPET,
} from './engine'
import { auditTurnaround } from './audit'
import type {
  ApronZone,
  FlightState,
  GateWeightItem,
  GroupId,
  NodeRunState,
  RunEvent,
  RunGroupState,
  RunLogEntry,
  ServiceConfigItem,
  SopVersion,
  TurnaroundFlight,
} from './types'

type TabName = 'overview' | 'pipeline' | 'logs' | 'config' | 'gates'
type RunState = 'idle' | 'running' | 'failed' | 'succeeded'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowClock(): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/* ---------- 顶部工具条与航班选择 ---------- */
const activeTab = ref<TabName>('overview')
const selectedFlightId = ref('CZ8821')
const zoneFilter = ref<'ALL' | ApronZone>('ALL')
const flights = ref<TurnaroundFlight[]>(clone(initialFlights))

const selectedFlight = computed(
  () => flights.value.find((flight) => flight.flightNo === selectedFlightId.value) ?? flights.value[0],
)

const zoneChips = computed(() => {
  const count = (zone: ApronZone) => flights.value.filter((flight) => flight.zone === zone).length
  return [
    { id: 'ALL' as const, label: '全部区域', count: flights.value.length },
    { id: 'A' as const, label: 'A 区', count: count('A') },
    { id: 'B' as const, label: 'B 区', count: count('B') },
    { id: 'C' as const, label: 'C 区', count: count('C') },
  ]
})

const overviewFlights = computed(() => {
  if (zoneFilter.value === 'ALL') return flights.value
  return flights.value.filter((flight) => flight.zone === zoneFilter.value)
})

const FLIGHT_STATE_TEXT: Record<FlightState, string> = {
  arrived: '到港对接',
  servicing: '保障中',
  hold: '暂扣等待',
  ready: '保障完成',
  departed: '已离港',
}

const FLIGHT_STATE_TAG: Record<FlightState, string> = {
  arrived: 'info',
  servicing: 'primary',
  hold: 'danger',
  ready: 'success',
  departed: 'info',
}

function onFlightRowClick(row: TurnaroundFlight) {
  selectedFlightId.value = row.flightNo
}

/* ---------- 保障流水线状态机 ---------- */
const sopVersion = ref<SopVersion>('v2')
const runState = ref<RunState>('idle')
const runGroups = ref<RunGroupState[]>([])
const runLogs = ref<RunLogEntry[]>([])
const logGroupFilter = ref<'all' | GroupId>('all')

let runGeneration = 0
const runTimers: ReturnType<typeof setTimeout>[] = []

function clearRunTimers() {
  runTimers.splice(0).forEach((handle) => clearTimeout(handle))
}

const displayGroups = computed<RunGroupState[]>(() => {
  if (runState.value === 'idle') {
    return sopPlans[sopVersion.value].map((group) => ({ id: group.id, state: 'pending', stepIndex: 0 }))
  }
  return runGroups.value
})

function planOf(groupId: GroupId) {
  return sopPlans[sopVersion.value].find((group) => group.id === groupId)
}

const GROUP_STATE_TEXT: Record<NodeRunState, string> = {
  pending: '待开始',
  running: '进行中',
  done: '已完成',
  failed: '失败',
  blocked: '已挂起',
}

watch(sopVersion, () => {
  if (runState.value !== 'running') {
    runGeneration += 1
    clearRunTimers()
    runState.value = 'idle'
    runGroups.value = []
    runLogs.value = []
  }
})

function applyEventToBoard(event: RunEvent) {
  runLogs.value.push(event.log)
  const group = runGroups.value.find((item) => item.id === event.groupId)
  if (!group) return
  if (event.kind === 'group-start') {
    group.state = 'running'
    return
  }
  if (event.kind === 'fatal') {
    group.state = 'failed'
    group.failedStepId = event.stepId
    runGroups.value = runGroups.value.map((item) =>
      item.id === event.groupId || item.state === 'done' ? item : { ...item, state: 'blocked' as NodeRunState },
    ).map((item) => (item.id === event.groupId ? { ...item, state: 'failed' as NodeRunState } : item))
    return
  }
  if (event.kind === 'step') {
    group.stepIndex += 1
    return
  }
  if (event.kind === 'group-done') {
    group.state = 'done'
    group.stepIndex = planOf(group.id)?.steps.length ?? group.stepIndex
  }
}

function patchSelectedFlight(patch: typeof failedFlightPatch | typeof succeededFlightPatch) {
  flights.value = flights.value.map((flight) =>
    flight.flightNo === selectedFlightId.value ? { ...flight, ...patch } : flight,
  )
}

async function startRun() {
  const generation = ++runGeneration
  clearRunTimers()
  runState.value = 'running'
  runLogs.value = []
  runGroups.value = sopPlans[sopVersion.value].map((group) => ({ id: group.id, state: 'pending', stepIndex: 0 }))

  const events = buildRunScript(sopVersion.value, savedConfigs.value, nowClock())
  let cursor = 0

  const tick = async () => {
    if (generation !== runGeneration) return
    if (cursor >= events.length) {
      runState.value = 'succeeded'
      patchSelectedFlight(succeededFlightPatch)
      ElMessage.success('保障链 3 个分组全部完成，可前往「登机口与放行」调整放行权重')
      return
    }
    const event = events[cursor]
    cursor += 1
    applyEventToBoard(event)

    if (event.kind === 'fatal') {
      runState.value = 'failed'
      patchSelectedFlight(failedFlightPatch)
      ElMessage.error('保障链在「航空配餐」分组失败，请查看节点日志并在资源配置中修复')
      return
    }
    try {
      await sleep(620)
    } catch {
      return
    }
    if (generation !== runGeneration) return
    void tick()
  }
  runTimers.push(setTimeout(() => void tick(), 420))
}

const runButtonText = computed(() => {
  if (runState.value === 'running') return '保障链推进中'
  if (runState.value === 'failed') return '重新执行'
  if (runState.value === 'succeeded') return '再次执行'
  return '开始执行'
})

function stepClass(group: RunGroupState, index: number): string {
  if (group.state === 'failed' && group.failedStepId === planOf(group.id)?.steps[index]?.id) return 'is-failed'
  if (index < group.stepIndex) return 'is-done'
  if (group.state === 'running' && index === group.stepIndex) return 'is-current'
  return ''
}

function timelineType(level: RunLogEntry['level']): string {
  if (level === 'fatal') return 'danger'
  if (level === 'warn') return 'warning'
  return 'primary'
}

const visibleLogs = computed(() => {
  if (logGroupFilter.value === 'all') return runLogs.value
  return runLogs.value.filter((entry) => entry.groupId === logGroupFilter.value)
})

function groupName(groupId: GroupId): string {
  return planOf(groupId)?.name ?? groupId
}

/* ---------- 资源配置 ---------- */
const savedConfigs = ref<ServiceConfigItem[]>(clone(initialSavedConfigs))
const configDraft = ref<ServiceConfigItem[]>(clone(initialSavedConfigs))

function addConfigRow() {
  configDraft.value.push({ key: '', value: '', remark: '' })
}

function removeConfigRow(index: number) {
  configDraft.value.splice(index, 1)
}

function saveConfigs() {
  const cleaned = configDraft.value
    .map((item) => ({ key: item.key.trim(), value: item.value.trim(), remark: item.remark.trim() }))
    .filter((item) => item.key.length > 0)
  const keys = new Set(cleaned.map((item) => item.key))
  if (keys.size !== cleaned.length) {
    ElMessage.error('存在重复的配置键，请修正后再保存')
    return
  }
  savedConfigs.value = clone(cleaned)
  configDraft.value = clone(cleaned)
  ElMessage.success('保障服务配置已保存并下发至机坪作业终端')
}

/* ---------- 登机口与放行 ---------- */
const appliedGateWeights = ref<GateWeightItem[]>(clone(initialGateWeights))
const gateDraft = ref<GateWeightItem[]>(clone(initialGateWeights))

const appliedC12 = computed(() => appliedGateWeights.value.find((gate) => gate.gate === 'C12')?.share ?? null)

function appliedShareOf(gate: string): number | null {
  return appliedGateWeights.value.find((item) => item.gate === gate)?.share ?? null
}

function applyGateRule() {
  appliedGateWeights.value = clone(gateDraft.value)
  const c12 = appliedGateWeights.value.find((gate) => gate.gate === 'C12')?.share ?? 0
  ElMessage.success(`放行规则已应用：旅客分流按 C08/C12/C18 权重下发（C12 当前 ${c12}%）`)
}

/* ---------- 体检探针 ---------- */
useModuleProbe('turnaround', {
  runChecks: () =>
    auditTurnaround({
      savedConfigs: clone(savedConfigs.value),
      runGroups: clone(runGroups.value),
      appliedGateWeights: clone(appliedGateWeights.value),
    }),
  resetModule: () => {
    runGeneration += 1
    clearRunTimers()
    activeTab.value = 'overview'
    selectedFlightId.value = 'CZ8821'
    zoneFilter.value = 'ALL'
    flights.value = clone(initialFlights)
    sopVersion.value = 'v2'
    runState.value = 'idle'
    runGroups.value = []
    runLogs.value = []
    logGroupFilter.value = 'all'
    savedConfigs.value = clone(initialSavedConfigs)
    configDraft.value = clone(initialSavedConfigs)
    appliedGateWeights.value = clone(initialGateWeights)
    gateDraft.value = clone(initialGateWeights)
  },
})

onBeforeUnmount(clearRunTimers)
</script>

<template>
  <div class="tac-console">
    <header class="tac-toolbar">
      <div class="tac-toolbar-left">
        <el-select v-model="selectedFlightId" size="small" class="tac-flight-select" filterable>
          <el-option v-for="flight in flights" :key="flight.id" :label="`${flight.flightNo} · 机位 ${flight.stand}`" :value="flight.flightNo" />
        </el-select>
        <div class="tac-zone-chips">
          <button
            v-for="chip in zoneChips"
            :key="chip.id"
            type="button"
            class="tac-zone-chip"
            :class="{ active: zoneFilter === chip.id }"
            @click="zoneFilter = chip.id"
          >
            {{ chip.label }} <b>{{ chip.count }}</b>
          </button>
        </div>
      </div>
      <div class="tac-flight-summary">
        <span class="tac-summary-flight">{{ selectedFlight.flightNo }}</span>
        <span class="tac-summary-item">机位 {{ selectedFlight.stand }}</span>
        <span class="tac-summary-item mono">{{ selectedFlight.registration }}</span>
        <span class="tac-summary-item">计划离港 {{ selectedFlight.etd }}</span>
        <el-tag size="small" :type="FLIGHT_STATE_TAG[selectedFlight.state] as never">
          {{ FLIGHT_STATE_TEXT[selectedFlight.state] }}
        </el-tag>
        <span class="tac-summary-node">{{ selectedFlight.currentNode }} → {{ selectedFlight.nextAction }}</span>
      </div>
    </header>

    <el-tabs v-model="activeTab" class="tac-tabs">
      <el-tab-pane label="保障总览" name="overview">
        <div class="tac-pane">
          <div class="tac-table-wrap">
            <el-table
              :data="overviewFlights"
              size="small"
              highlight-current-row
              :row-class-name="({ row }: { row: TurnaroundFlight }) => (row.flightNo === selectedFlightId ? 'is-picked' : '')"
              @row-click="onFlightRowClick"
            >
              <el-table-column prop="flightNo" label="航班号" width="110">
                <template #default="{ row }">
                  <span class="mono strong">{{ row.flightNo }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="stand" label="机位" width="90" />
              <el-table-column prop="zone" label="停机坪区" width="100" align="center">
                <template #default="{ row }">{{ row.zone }} 区</template>
              </el-table-column>
              <el-table-column prop="registration" label="注册号" width="110">
                <template #default="{ row }"><span class="mono">{{ row.registration }}</span></template>
              </el-table-column>
              <el-table-column prop="etd" label="计划离港" width="100" />
              <el-table-column prop="state" label="状态" width="110">
                <template #default="{ row }">
                  <el-tag size="small" :type="FLIGHT_STATE_TAG[row.state as FlightState] as never">
                    {{ FLIGHT_STATE_TEXT[row.state as FlightState] }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="currentNode" label="当前保障节点" min-width="150" />
              <el-table-column prop="nextAction" label="下一动作" min-width="170" />
              <el-table-column label="" width="90" align="center" fixed="right">
                <template #default="{ row }">
                  <el-button
                    type="primary"
                    link
                    size="small"
                    @click.stop="selectedFlightId = row.flightNo; activeTab = 'pipeline'"
                  >
                    保障链
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="保障流水线" name="pipeline">
        <div class="tac-pane tac-pane-pad">
          <div class="tac-run-toolbar">
            <label class="tac-run-field">
              目标 SOP
              <el-select v-model="sopVersion" size="small" :disabled="runState === 'running'" class="tac-sop-select">
                <el-option label="SOP-v2（精简链）" value="v2" />
                <el-option label="SOP-v3（带复核链）" value="v3" />
              </el-select>
            </label>
            <el-button
              type="primary"
              size="small"
              :icon="runState === 'succeeded' ? RefreshRight : Timer"
              :loading="runState === 'running'"
              :disabled="runState === 'running'"
              @click="startRun"
            >
              {{ runButtonText }}
            </el-button>
            <span class="tac-run-hint">选定航班：{{ selectedFlight.flightNo }}（机位 {{ selectedFlight.stand }}）</span>
          </div>

          <div class="tac-run-board">
            <template v-for="(group, index) in displayGroups" :key="group.id">
              <div class="tac-run-card" :class="`is-${group.state}`">
                <header class="tac-run-head">
                  <span class="tac-run-name">{{ planOf(group.id)?.name }}</span>
                  <span class="tac-run-chip">{{ GROUP_STATE_TEXT[group.state] }}</span>
                </header>
                <p class="tac-run-crew">{{ planOf(group.id)?.crew }}</p>
                <ol class="tac-run-steps">
                  <li
                    v-for="(step, stepIdx) in planOf(group.id)?.steps ?? []"
                    :key="step.id"
                    :class="stepClass(group, stepIdx)"
                  >
                    <el-icon v-if="stepClass(group, stepIdx) === 'is-done'" class="tac-step-icon done"><CircleCheckFilled /></el-icon>
                    <el-icon v-else-if="stepClass(group, stepIdx) === 'is-failed'" class="tac-step-icon failed"><CircleCloseFilled /></el-icon>
                    <el-icon v-else-if="stepClass(group, stepIdx) === 'is-current'" class="tac-step-icon current is-loading"><Loading /></el-icon>
                    <span v-else class="tac-step-dot" />
                    <span>{{ step.label }}</span>
                  </li>
                </ol>
              </div>
              <div v-if="index < displayGroups.length - 1" class="tac-run-arrow">→</div>
            </template>
          </div>

          <div v-if="runState === 'failed'" class="tac-alert is-error">
            <el-icon :size="16"><WarningFilled /></el-icon>
            <div>
              <strong>保障链中断 · {{ VENDOR_FATAL_SNIPPET }}</strong>
              <p>
                「航空配餐」分组的装载指令无法下发，后续「加油勤务」已挂起。请查看
                <button type="button" class="tac-link" @click="activeTab = 'logs'">节点日志</button>，并到
                <button type="button" class="tac-link" @click="activeTab = 'config'">资源配置</button>
                补齐供应商网关配置后重新执行。
              </p>
            </div>
          </div>
          <div v-else-if="runState === 'succeeded'" class="tac-alert is-ok">
            <el-icon :size="16"><CircleCheckFilled /></el-icon>
            <div>
              <strong>SOP-{{ sopVersion }} 保障链全部完成</strong>
              <p>
                3 个保障分组均已转绿，可前往
                <button type="button" class="tac-link" @click="activeTab = 'gates'">登机口与放行</button>
                调整旅客放行权重。
              </p>
            </div>
          </div>
          <div v-else-if="runState === 'running'" class="tac-alert is-info">保障链正在按 SOP-{{ sopVersion }} 逐节点推进，请留意各分组状态变化。</div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="节点日志" name="logs">
        <div class="tac-pane tac-pane-pad">
          <div class="tac-log-toolbar">
            <el-radio-group v-model="logGroupFilter" size="small">
              <el-radio-button value="all">全部分组</el-radio-button>
              <el-radio-button value="cabin">客舱清洁</el-radio-button>
              <el-radio-button value="catering">航空配餐</el-radio-button>
              <el-radio-button value="fuel">加油勤务</el-radio-button>
            </el-radio-group>
            <span class="tac-log-count">共 {{ visibleLogs.length }} 条</span>
          </div>
          <div v-if="visibleLogs.length === 0" class="tac-log-empty">暂无执行日志，请先在「保障流水线」执行保障链。</div>
          <el-timeline v-else class="tac-log-timeline">
            <el-timeline-item
              v-for="entry in visibleLogs"
              :key="entry.seq"
              :timestamp="entry.time"
              :type="timelineType(entry.level) as never"
              placement="top"
            >
              <div class="tac-log-line" :class="`level-${entry.level}`">
                <span class="tac-log-scope">[{{ groupName(entry.groupId) }} · {{ entry.step }}]</span>
                <span class="tac-log-msg">{{ entry.message }}</span>
              </div>
            </el-timeline-item>
          </el-timeline>
        </div>
      </el-tab-pane>

      <el-tab-pane label="资源配置" name="config">
        <div class="tac-pane tac-pane-pad">
          <div class="tac-config-toolbar">
            <div class="tac-config-title">
              保障服务配置 · <span class="mono">{{ selectedFlight.flightNo }}</span>
              <small>修改后需点击保存才会下发生效</small>
            </div>
            <div class="tac-config-actions">
              <el-button size="small" :icon="Plus" @click="addConfigRow">新增配置项</el-button>
              <el-button type="primary" size="small" @click="saveConfigs">保存配置</el-button>
            </div>
          </div>
          <el-table :data="configDraft" size="small">
            <el-table-column label="配置键" min-width="220">
              <template #default="{ row }">
                <el-input v-model="row.key" placeholder="如 CATERER_VENDOR" size="small" class="mono" />
              </template>
            </el-table-column>
            <el-table-column label="配置值" min-width="280">
              <template #default="{ row }">
                <el-input v-model="row.value" placeholder="如 gateway-catering-group:9120" size="small" class="mono" />
              </template>
            </el-table-column>
            <el-table-column label="说明" min-width="240">
              <template #default="{ row }">
                <el-input v-model="row.remark" placeholder="配置用途说明" size="small" />
              </template>
            </el-table-column>
            <el-table-column label="" width="64" align="center">
              <template #default="{ $index }">
                <el-button type="danger" link size="small" :icon="Delete" @click="removeConfigRow($index)" />
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <el-tab-pane label="登机口与放行" name="gates">
        <div class="tac-pane tac-pane-pad">
          <div class="tac-gate-toolbar">
            <div class="tac-config-title">
              旅客登机口放行权重 · <span class="mono">{{ selectedFlight.flightNo }}</span>
              <small>调整权重后需点击「应用放行规则」才会生效</small>
            </div>
            <el-button type="primary" size="small" :icon="Promotion" @click="applyGateRule">应用放行规则</el-button>
          </div>

          <div class="tac-gate-cards">
            <div v-for="gate in gateDraft" :key="gate.gate" class="tac-gate-card" :class="{ 'is-focused': gate.gate === 'C12' }">
              <header class="tac-gate-head">
                <span class="tac-gate-name">{{ gate.gate }}</span>
                <span class="tac-gate-applied">已应用 {{ appliedShareOf(gate.gate) ?? 0 }}%</span>
              </header>
              <div class="tac-gate-share">{{ gate.share }}<small>%</small></div>
              <el-slider v-model="gate.share" :min="0" :max="100" :step="5" />
              <p class="tac-gate-desc">近廊桥口 · {{ gate.gate === 'C12' ? '双通道登机' : '单通道登机' }}</p>
            </div>
          </div>

          <div v-if="appliedC12 === 100" class="tac-alert is-ok">
            <el-icon :size="16"><CircleCheckFilled /></el-icon>
            <div>
              <strong>C12 登机口已按 100% 全量放行</strong>
              <p>放行规则已下发航站楼广播与登机口显示屏，旅客分流按新权重执行。</p>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.tac-console {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #f0f4f6;
  color: #17323c;
}

.tac-toolbar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid #dde7ea;
}

.tac-toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.tac-flight-select {
  width: 220px;
}

.tac-zone-chips {
  display: flex;
  gap: 6px;
}

.tac-zone-chip {
  height: 26px;
  padding: 0 10px;
  border: 1px solid #cfdee3;
  border-radius: 4px;
  background: #fff;
  color: #3f5b66;
  font-size: 12px;
  cursor: pointer;
}

.tac-zone-chip b {
  font-weight: 600;
  margin-left: 2px;
}

.tac-zone-chip.active {
  border-color: #0e7490;
  color: #0e7490;
  background: #e8f4f7;
}

.tac-flight-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #4c6b77;
}

.tac-summary-flight {
  font-size: 15px;
  font-weight: 700;
  color: #0e7490;
}

.tac-summary-node {
  color: #6d8792;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.strong {
  font-weight: 600;
}

.tac-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 14px 10px;
  background: #fff;
}

.tac-tabs :deep(.el-tabs__header) {
  margin: 0;
}

.tac-tabs :deep(.el-tabs__item.is-active),
.tac-tabs :deep(.el-tabs__item:hover) {
  color: #0e7490;
}

.tac-tabs :deep(.el-tabs__active-bar) {
  background-color: #0e7490;
}

.tac-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.tac-tabs :deep(.el-tab-pane) {
  height: 100%;
}

.tac-pane {
  height: 100%;
  overflow: auto;
}

.tac-pane-pad {
  padding: 14px 4px 20px;
}

.tac-table-wrap :deep(.is-picked) {
  background: #e9f4f7;
}

.tac-table-wrap :deep(.el-table__row) {
  cursor: pointer;
}

.tac-run-toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
}

.tac-run-field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #4c6b77;
}

.tac-sop-select {
  width: 190px;
}

.tac-run-hint {
  font-size: 12px;
  color: #6d8792;
}

.tac-console :deep(.el-button--primary) {
  --el-button-bg-color: #0e7490;
  --el-button-border-color: #0e7490;
  --el-button-hover-bg-color: #158aa9;
  --el-button-hover-border-color: #158aa9;
  --el-button-active-bg-color: #0b5e75;
  --el-button-active-border-color: #0b5e75;
}

.tac-run-board {
  display: flex;
  align-items: stretch;
  gap: 10px;
}

.tac-run-card {
  flex: 1;
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid #d8e4e8;
  border-radius: 8px;
  background: #fbfdfe;
}

.tac-run-card.is-running {
  border-color: #0e7490;
  box-shadow: 0 0 0 1px rgba(14, 116, 144, 0.25);
}

.tac-run-card.is-done {
  border-color: #86d9b9;
  background: #f2fbf7;
}

.tac-run-card.is-failed {
  border-color: #e39a9a;
  background: #fdf4f4;
}

.tac-run-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tac-run-name {
  font-size: 14px;
  font-weight: 600;
}

.tac-run-chip {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: #e3edf1;
  color: #4c6b77;
}

.tac-run-card.is-running .tac-run-chip {
  background: rgba(14, 116, 144, 0.12);
  color: #0e7490;
}

.tac-run-card.is-done .tac-run-chip {
  background: #d7f2e4;
  color: #15803d;
}

.tac-run-card.is-failed .tac-run-chip {
  background: #fbe0e0;
  color: #b91c1c;
}

.tac-run-crew {
  margin: 4px 0 10px;
  font-size: 12px;
  color: #6d8792;
}

.tac-run-steps {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tac-run-steps li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: #52707c;
}

.tac-run-steps li.is-done {
  color: #15803d;
}

.tac-run-steps li.is-failed {
  color: #b91c1c;
  font-weight: 600;
}

.tac-run-steps li.is-current {
  color: #0e7490;
  font-weight: 600;
}

.tac-step-icon.done {
  color: #16a34a;
}

.tac-step-icon.failed {
  color: #dc2626;
}

.tac-step-icon.current {
  color: #0e7490;
}

.tac-step-dot {
  width: 12px;
  height: 12px;
  border: 1.5px solid #b9cbd2;
  border-radius: 50%;
  box-sizing: border-box;
}

.tac-run-arrow {
  align-self: center;
  color: #8fa9b3;
  font-size: 16px;
}

.tac-alert {
  display: flex;
  gap: 10px;
  margin-top: 18px;
  padding: 12px 14px;
  border-radius: 6px;
  border: 1px solid;
  font-size: 13px;
  line-height: 1.55;
}

.tac-alert p {
  margin: 4px 0 0;
  font-size: 12.5px;
}

.tac-alert.is-error {
  background: #fdf3f3;
  border-color: #eec6c6;
  color: #b91c1c;
}

.tac-alert.is-ok {
  background: #f1faf5;
  border-color: #bfe6d2;
  color: #15803d;
}

.tac-alert.is-info {
  background: #eef7fa;
  border-color: #c5e0e8;
  color: #0e7490;
}

.tac-link {
  padding: 0;
  border: none;
  background: none;
  color: #0e7490;
  font-size: 12.5px;
  text-decoration: underline;
  cursor: pointer;
}

.tac-log-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.tac-log-count {
  font-size: 12px;
  color: #6d8792;
}

.tac-log-empty {
  padding: 48px 0;
  text-align: center;
  font-size: 13px;
  color: #6d8792;
}

.tac-log-timeline {
  padding: 6px 6px 6px 2px;
}

.tac-log-line {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  color: #33505b;
}

.tac-log-scope {
  margin-right: 8px;
  color: #6d8792;
}

.tac-log-line.level-warn .tac-log-msg {
  color: #b45309;
}

.tac-log-line.level-fatal {
  color: #b91c1c;
}

.tac-log-line.level-fatal .tac-log-msg {
  font-weight: 600;
  word-break: break-all;
}

.tac-config-toolbar,
.tac-gate-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.tac-config-title {
  font-size: 13.5px;
  font-weight: 600;
}

.tac-config-title small {
  margin-left: 10px;
  font-weight: 400;
  font-size: 12px;
  color: #6d8792;
}

.tac-config-actions {
  display: flex;
  gap: 8px;
}

.tac-gate-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.tac-gate-card {
  padding: 14px 16px 6px;
  border: 1px solid #d8e4e8;
  border-radius: 8px;
  background: #fbfdfe;
}

.tac-gate-card.is-focused {
  border-color: rgba(14, 116, 144, 0.55);
}

.tac-gate-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tac-gate-name {
  font-size: 15px;
  font-weight: 700;
  color: #0e7490;
}

.tac-gate-applied {
  font-size: 11.5px;
  color: #6d8792;
}

.tac-gate-share {
  margin: 6px 0 10px;
  font-size: 26px;
  font-weight: 700;
}

.tac-gate-share small {
  font-size: 13px;
  font-weight: 400;
  color: #6d8792;
}

.tac-gate-desc {
  margin: 4px 0 8px;
  font-size: 12px;
  color: #6d8792;
}
</style>
