<script setup lang="ts">
import { computed } from 'vue'
import { Connection, Position } from '@element-plus/icons-vue'
import type { WorkOrder } from './types'

const props = defineProps<{
  order: WorkOrder
  dragging: boolean
  canAdvance: boolean
}>()

const emit = defineEmits(['open', 'advance'])

const prioClass = computed(() => props.order.priority.slice(0, 2).toLowerCase())

const percent = computed(() =>
  props.order.subtasksTotal > 0
    ? Math.round((props.order.subtasksDone / props.order.subtasksTotal) * 100)
    : 0,
)

const barColor = computed(() => {
  if (prioClass.value === 'p0') return '#dc2626'
  if (prioClass.value === 'p1') return '#d97706'
  if (prioClass.value === 'p2') return '#0e7490'
  return '#94a3b8'
})
</script>

<template>
  <article class="wo-card" :class="[prioClass, { 'is-dragging': dragging }]">
    <div class="wo-head">
      <span class="wo-no">{{ order.id }}</span>
      <span class="wo-prio" :class="prioClass">{{ order.priority }}</span>
    </div>
    <button type="button" class="wo-title" @click="$emit('open')">{{ order.title }}</button>
    <div class="wo-meta">
      <span class="wo-aircraft">{{ order.aircraft }}</span>
      <span class="wo-tech"><i class="wo-avatar">{{ order.technician.slice(0, 1) }}</i>{{ order.technician }}</span>
    </div>
    <div class="wo-stats">
      <span class="wo-hours">工时 {{ order.manHours }}h</span>
      <span v-if="order.blockers.length > 0" class="wo-blocker">
        <el-icon :size="12"><Connection /></el-icon>{{ order.blockers.length }}
      </span>
      <el-progress class="wo-bar" :percentage="percent" :stroke-width="4" :show-text="false" :color="barColor" />
      <span class="wo-sub-count">{{ order.subtasksDone }}/{{ order.subtasksTotal }}</span>
    </div>
    <div class="wo-actions">
      <el-button v-if="canAdvance" size="small" link type="primary" @click.stop="$emit('advance')">
        <el-icon class="wo-btn-icon"><Position /></el-icon>流转下一站
      </el-button>
      <el-button size="small" link @click.stop="$emit('open')">详情</el-button>
    </div>
  </article>
</template>

<style scoped>
.wo-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-left-width: 3px;
  border-radius: 8px;
  padding: 9px 11px 7px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  cursor: grab;
  user-select: none;
}

.wo-card:active {
  cursor: grabbing;
}

.wo-card.p0 { border-left-color: #dc2626; }
.wo-card.p1 { border-left-color: #d97706; }
.wo-card.p2 { border-left-color: #0e7490; }
.wo-card.p3 { border-left-color: #94a3b8; }

.wo-card.is-dragging {
  opacity: 0.4;
}

.wo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.wo-no {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: #64748b;
}

.wo-prio {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
}

.wo-prio.p0 { color: #dc2626; background: #fef2f2; }
.wo-prio.p1 { color: #b45309; background: #fffbeb; }
.wo-prio.p2 { color: #0e7490; background: #ecfeff; }
.wo-prio.p3 { color: #64748b; background: #f1f5f9; }

.wo-title {
  display: block;
  width: 100%;
  margin: 5px 0 6px;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: #0f172a;
  cursor: pointer;
}

.wo-title:hover {
  color: #0e7490;
}

.wo-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: #475569;
  margin-bottom: 7px;
}

.wo-tech {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.wo-avatar {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #0e7490;
  color: #fff;
  font-style: normal;
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.wo-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #64748b;
}

.wo-hours {
  white-space: nowrap;
}

.wo-blocker {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: #b45309;
}

.wo-bar {
  flex: 1;
}

.wo-sub-count {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.wo-actions {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid #f1f5f9;
}

.wo-btn-icon {
  margin-right: 3px;
}
</style>
