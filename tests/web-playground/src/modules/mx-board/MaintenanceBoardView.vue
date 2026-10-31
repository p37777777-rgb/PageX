<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Connection } from '@element-plus/icons-vue'
import { useModuleProbe } from '../../probe'
import { auditMaintenanceBoard } from './audit'
import {
  advanceOrder,
  countOrders,
  locateOrder,
  moveOrder,
  nextLaneId,
  visibleOrders,
} from './board'
import {
  DEPENDENCY_CANDIDATES,
  INITIAL_LANES,
  PRIORITY_OPTIONS,
  TECHNICIANS,
} from './data'
import type { LaneId, MaintenanceLane, WorkOrder } from './types'
import WorkOrderCard from './WorkOrderCard.vue'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const lanes = ref<MaintenanceLane[]>(clone(INITIAL_LANES))
const technicianFilter = ref('')
const priorityFilter = ref('')

const totalOrders = computed(() => countOrders(lanes.value))

function ordersIn(lane: MaintenanceLane): WorkOrder[] {
  return visibleOrders(lane.orders, technicianFilter.value, priorityFilter.value)
}

/* ---------- HTML5 拖拽：跨泳道移动 + 列内排序（含列首） ---------- */
interface DropHint {
  laneId: LaneId
  /** 插入到该可见工单之前；null 表示列尾 */
  beforeOrderId: string | null
}

const dragOrderId = ref('')
const dropHint = ref<DropHint | null>(null)

function onDragStart(event: DragEvent, order: WorkOrder) {
  dragOrderId.value = order.id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', order.id)
  }
}

function onDragEnd() {
  dragOrderId.value = ''
  dropHint.value = null
}

function onCardDragOver(event: DragEvent, lane: MaintenanceLane, visibleIndex: number) {
  if (!dragOrderId.value) return
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const before = event.clientY < rect.top + rect.height / 2
  const visible = ordersIn(lane)
  const beforeId = before
    ? visible[visibleIndex].id
    : visibleIndex + 1 < visible.length
      ? visible[visibleIndex + 1].id
      : null
  dropHint.value = { laneId: lane.id, beforeOrderId: beforeId }
}

function onLaneDragOver(event: DragEvent, lane: MaintenanceLane) {
  if (!dragOrderId.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropHint.value = { laneId: lane.id, beforeOrderId: null }
}

function onLaneDragLeave(event: DragEvent, laneId: LaneId) {
  const related = event.relatedTarget as Node | null
  const host = event.currentTarget as HTMLElement
  if ((!related || !host.contains(related)) && dropHint.value?.laneId === laneId) {
    dropHint.value = null
  }
}

function onDrop(event: DragEvent, lane: MaintenanceLane) {
  if (!dragOrderId.value) return
  event.preventDefault()
  const hint = dropHint.value?.laneId === lane.id ? dropHint.value.beforeOrderId : null
  commitMove(lane.id, hint)
}

function commitMove(targetLaneId: LaneId, beforeOrderId: string | null) {
  const orderId = dragOrderId.value
  const located = locateOrder(lanes.value, orderId)
  dragOrderId.value = ''
  dropHint.value = null
  if (!located) return

  let targetIndex = Number.MAX_SAFE_INTEGER
  if (beforeOrderId !== null) {
    const anchorIndex = lanes.value
      .find((lane) => lane.id === targetLaneId)
      ?.orders.findIndex((candidate) => candidate.id === beforeOrderId)
    if (anchorIndex === undefined || anchorIndex < 0) return
    targetIndex = anchorIndex
  }

  lanes.value = moveOrder(lanes.value, orderId, targetLaneId, targetIndex)
  if (located.laneId !== targetLaneId) {
    const laneTitle = lanes.value.find((lane) => lane.id === targetLaneId)?.title ?? ''
    ElMessage.success(`「${located.order.title}」已移至「${laneTitle}」`)
  }
}

/* ---------- 快捷流转：推到下一泳道并置顶 ---------- */
function onAdvance(order: WorkOrder) {
  const located = locateOrder(lanes.value, order.id)
  const next = located ? nextLaneId(located.laneId) : null
  if (!located || !next) return
  lanes.value = advanceOrder(lanes.value, order.id)
  const laneTitle = lanes.value.find((lane) => lane.id === next)?.title ?? ''
  ElMessage.success(`「${order.title}」已流转至「${laneTitle}」并置顶`)
}

/* ---------- 详情抽屉与阻塞依赖 ---------- */
const drawerVisible = ref(false)
const activeOrderId = ref('')
const blockerCandidate = ref('')

const activeOrder = computed<WorkOrder | null>(
  () => locateOrder(lanes.value, activeOrderId.value)?.order ?? null,
)

const candidateOptions = computed(() =>
  DEPENDENCY_CANDIDATES.filter((candidate) => !activeOrder.value?.blockers.includes(candidate)),
)

function openDrawer(order: WorkOrder) {
  activeOrderId.value = order.id
  blockerCandidate.value = ''
  drawerVisible.value = true
}

function addBlocker() {
  const order = activeOrder.value
  if (!order || !blockerCandidate.value) return
  if (!order.blockers.includes(blockerCandidate.value)) {
    order.blockers.push(blockerCandidate.value)
    ElMessage.success(`已添加阻塞依赖：${blockerCandidate.value}`)
  }
  blockerCandidate.value = ''
}

function removeBlocker(dep: string) {
  const order = activeOrder.value
  if (!order) return
  order.blockers = order.blockers.filter((item) => item !== dep)
}

function saveAndClose() {
  ElMessage.success('工单依赖已保存')
  drawerVisible.value = false
}

/* ---------- 拖拽指示线 ---------- */
function isLineBefore(laneId: LaneId, orderId: string): boolean {
  const hint = dropHint.value
  return hint !== null && hint.laneId === laneId && hint.beforeOrderId === orderId
}

function isLineAtEnd(laneId: LaneId): boolean {
  const hint = dropHint.value
  return hint !== null && hint.laneId === laneId && hint.beforeOrderId === null
}

/* ---------- 体检探针 ---------- */
function resetModule() {
  lanes.value = clone(INITIAL_LANES)
  technicianFilter.value = ''
  priorityFilter.value = ''
  drawerVisible.value = false
  activeOrderId.value = ''
  blockerCandidate.value = ''
  dragOrderId.value = ''
  dropHint.value = null
}

useModuleProbe('mx-board', {
  runChecks: () =>
    auditMaintenanceBoard({
      lanes: clone(lanes.value),
      technicianFilter: technicianFilter.value,
    }),
  resetModule,
})
</script>

<template>
  <div class="mx-board">
    <header class="mx-toolbar">
      <div class="mx-brand">
        <span class="mx-logo">MX</span>
        <div class="mx-brand-text">
          <strong>维修排程</strong>
          <small>凌越航空 · 航线机务工单看板</small>
        </div>
        <span class="mx-count">在办工单 {{ totalOrders }}</span>
      </div>
      <div class="mx-filters">
        <el-select
          v-model="technicianFilter"
          placeholder="全部技师"
          size="small"
          clearable
          class="mx-filter"
        >
          <el-option v-for="name in TECHNICIANS" :key="name" :label="name" :value="name" />
        </el-select>
        <el-select
          v-model="priorityFilter"
          placeholder="全部优先级"
          size="small"
          clearable
          class="mx-filter"
        >
          <el-option v-for="p in PRIORITY_OPTIONS" :key="p" :label="p" :value="p" />
        </el-select>
      </div>
    </header>

    <main class="mx-viewport">
      <div class="mx-track">
        <section
          v-for="lane in lanes"
          :key="lane.id"
          class="mx-lane"
          :class="[`lane-${lane.id}`, { 'is-drop-hover': dropHint?.laneId === lane.id }]"
          @dragover="onLaneDragOver($event, lane)"
          @dragleave="onLaneDragLeave($event, lane.id)"
          @drop="onDrop($event, lane)"
        >
          <header class="mx-lane-head">
            <span class="mx-lane-dot" />
            <h3>{{ lane.title }}</h3>
            <span class="mx-lane-count">{{ ordersIn(lane).length }}/{{ lane.orders.length }}</span>
          </header>
          <div class="mx-lane-body">
            <template v-for="(order, vi) in ordersIn(lane)" :key="order.id">
              <div v-if="isLineBefore(lane.id, order.id)" class="mx-drop-line" />
              <WorkOrderCard
                :order="order"
                :dragging="dragOrderId === order.id"
                :can-advance="nextLaneId(lane.id) !== null"
                draggable="true"
                @dragstart="onDragStart($event, order)"
                @dragover="onCardDragOver($event, lane, vi)"
                @dragend="onDragEnd"
                @open="openDrawer(order)"
                @advance="onAdvance(order)"
              />
            </template>
            <div v-if="isLineAtEnd(lane.id)" class="mx-drop-line" />
            <p v-if="ordersIn(lane).length === 0" class="mx-lane-empty">该泳道暂无匹配工单</p>
          </div>
        </section>
      </div>
    </main>

    <el-drawer
      v-model="drawerVisible"
      :title="activeOrder ? `${activeOrder.id} 工单详情` : '工单详情'"
      size="460px"
    >
      <div v-if="activeOrder" class="mx-drawer">
        <h3 class="mx-drawer-title">{{ activeOrder.title }}</h3>
        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item label="工单号">{{ activeOrder.id }}</el-descriptions-item>
          <el-descriptions-item label="机型 / 注册号">{{ activeOrder.aircraft }}</el-descriptions-item>
          <el-descriptions-item label="技师">{{ activeOrder.technician }}</el-descriptions-item>
          <el-descriptions-item label="优先级">{{ activeOrder.priority }}</el-descriptions-item>
          <el-descriptions-item label="额定工时">{{ activeOrder.manHours }} h</el-descriptions-item>
          <el-descriptions-item label="子任务进度">
            {{ activeOrder.subtasksDone }}/{{ activeOrder.subtasksTotal }}
          </el-descriptions-item>
        </el-descriptions>

        <section class="mx-blockers">
          <h4>阻塞依赖</h4>
          <p class="mx-blocker-tip">下列工程未关闭前，本工单不得放行</p>
          <p v-if="activeOrder.blockers.length === 0" class="mx-blocker-empty">暂无阻塞依赖</p>
          <div v-for="dep in activeOrder.blockers" :key="dep" class="mx-blocker-row">
            <el-icon :size="14"><Connection /></el-icon>
            <span>{{ dep }}</span>
            <el-button type="danger" link size="small" @click="removeBlocker(dep)">移除</el-button>
          </div>
          <div class="mx-blocker-add">
            <el-select
              v-model="blockerCandidate"
              placeholder="选择前置工程"
              size="small"
              clearable
              filterable
              class="mx-blocker-select"
            >
              <el-option v-for="c in candidateOptions" :key="c" :label="c" :value="c" />
            </el-select>
            <el-button type="primary" size="small" :disabled="!blockerCandidate" @click="addBlocker">
              添加依赖
            </el-button>
          </div>
        </section>

        <div class="mx-drawer-foot">
          <el-button type="primary" @click="saveAndClose">保存并关闭</el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.mx-board {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #f1f5f9;
  color: #0f172a;
}

/* ---------- 顶部工具条 ---------- */
.mx-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 16px;
  padding: 10px 16px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
}

.mx-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mx-logo {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #0e7490;
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  letter-spacing: 0.02em;
}

.mx-brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.mx-brand-text strong {
  font-size: 15px;
}

.mx-brand-text small {
  font-size: 11px;
  color: #64748b;
}

.mx-count {
  margin-left: 10px;
  font-size: 12px;
  color: #0e7490;
  background: #ecfeff;
  border: 1px solid #a5f3fc;
  border-radius: 999px;
  padding: 2px 10px;
}

.mx-filters {
  display: flex;
  gap: 8px;
}

.mx-filter {
  width: 132px;
}

/* ---------- 看板视口（横向滚动） ---------- */
.mx-viewport {
  flex: 1;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.mx-track {
  display: flex;
  gap: 12px;
  height: 100%;
  min-width: 1680px;
  padding: 12px 14px;
  box-sizing: border-box;
}

.mx-lane {
  flex: 1 1 0;
  min-width: 316px;
  display: flex;
  flex-direction: column;
  background: #eef2f6;
  border: 1px solid transparent;
  border-radius: 10px;
  min-height: 0;
}

.mx-lane.is-drop-hover {
  background: #e0f4f8;
  border-color: #0e7490;
  border-style: dashed;
}

.mx-lane-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 12px 6px;
}

.mx-lane-head h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #334155;
}

.mx-lane-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.lane-assess .mx-lane-dot { background: #64748b; }
.lane-prepare .mx-lane-dot { background: #d97706; }
.lane-working .mx-lane-dot { background: #0e7490; }
.lane-review .mx-lane-dot { background: #7c3aed; }
.lane-released .mx-lane-dot { background: #059669; }

.mx-lane-count {
  margin-left: auto;
  font-size: 11px;
  color: #64748b;
  background: #ffffff;
  border-radius: 999px;
  padding: 1px 8px;
  font-variant-numeric: tabular-nums;
}

.mx-lane-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 10px 10px;
}

.mx-lane-empty {
  margin: 0;
  padding: 22px 0;
  text-align: center;
  font-size: 12px;
  color: #94a3b8;
}

.mx-drop-line {
  height: 3px;
  border-radius: 999px;
  background: #0e7490;
  box-shadow: 0 0 0 3px rgba(14, 116, 144, 0.16);
  flex-shrink: 0;
}

/* ---------- 详情抽屉 ---------- */
.mx-drawer-title {
  margin: 0 0 14px;
  font-size: 17px;
}

.mx-blockers {
  margin-top: 20px;
}

.mx-blockers h4 {
  margin: 0 0 4px;
  font-size: 13px;
}

.mx-blocker-tip,
.mx-blocker-empty {
  margin: 0 0 8px;
  font-size: 12px;
  color: #64748b;
}

.mx-blocker-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 8px 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #b45309;
  font-size: 13px;
}

.mx-blocker-row span {
  flex: 1;
  color: #0f172a;
}

.mx-blocker-add {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.mx-blocker-select {
  flex: 1;
}

.mx-drawer-foot {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
}
</style>
