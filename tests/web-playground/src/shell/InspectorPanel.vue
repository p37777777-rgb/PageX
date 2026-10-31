<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { activeProbe } from '../probe'
import type { InspectionItem } from '../probe'

const route = useRoute()
const reportOpen = ref(false)
const items = ref<InspectionItem[] | null>(null)

const summary = computed(() => {
  const rows = items.value ?? []
  return {
    ok: rows.filter((row) => row.result === 'ok').length,
    miss: rows.filter((row) => row.result === 'miss').length,
    pending: rows.filter((row) => row.result === 'pending').length,
  }
})

function inspect() {
  items.value = activeProbe.value?.runChecks() ?? []
  reportOpen.value = true
}

function restore() {
  activeProbe.value?.resetModule()
  items.value = null
  reportOpen.value = false
}

watch(
  () => route.fullPath,
  () => {
    reportOpen.value = false
  },
)
</script>

<template>
  <div class="inspector">
    <p class="inspector-title">运行体检</p>
    <el-popover :visible="reportOpen" placement="right-start" :width="360" trigger="click">
      <template #reference>
        <button type="button" class="inspector-btn" @click="inspect">执行体检</button>
      </template>
      <div class="report" @mouseleave="reportOpen = false">
        <header class="report-head">
          <strong>体检报告</strong>
          <span class="report-counts">
            <i class="dot ok" />通过 {{ summary.ok }} · <i class="dot miss" />未过 {{ summary.miss }} ·
            <i class="dot pending" />存疑 {{ summary.pending }}
          </span>
        </header>
        <p v-if="items && items.length === 0" class="report-empty">当前页面没有可体检的模块</p>
        <ul v-else class="report-list">
          <li v-for="row in items" :key="row.key" class="report-item">
            <span class="row-state" :class="row.result">
              {{ row.result === 'ok' ? '✓' : row.result === 'miss' ? '✕' : '?' }}
            </span>
            <div class="row-body">
              <p class="row-title">{{ row.title }}</p>
              <p v-if="row.result === 'miss' && row.expect" class="row-detail">
                期望 {{ row.expect }}<template v-if="row.got"> · 实际 {{ row.got }}</template>
              </p>
              <p v-else-if="row.got" class="row-detail">{{ row.got }}</p>
            </div>
          </li>
        </ul>
      </div>
    </el-popover>
    <button type="button" class="inspector-btn ghost" @click="restore">恢复初始</button>
  </div>
</template>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.inspector-title {
  margin: 0;
  color: #5c7a97;
  font-size: 11px;
  letter-spacing: 2px;
}

.inspector-btn {
  padding: 5px 12px;
  border: 1px solid rgba(45, 212, 238, 0.35);
  border-radius: 6px;
  background: rgba(45, 212, 238, 0.08);
  color: #7ce7f7;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.inspector-btn:hover {
  background: rgba(45, 212, 238, 0.18);
}

.inspector-btn.ghost {
  border-color: rgba(139, 163, 191, 0.3);
  background: transparent;
  color: #8ba3bf;
}

.inspector-btn.ghost:hover {
  color: #e8f0f8;
  border-color: rgba(139, 163, 191, 0.6);
}

.report-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e4ebf1;
}

.report-counts {
  font-size: 11px;
  color: #6b7f92;
}

.dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin: 0 3px 1px 6px;
  border-radius: 50%;
}

.dot.ok {
  background: #16a34a;
}

.dot.miss {
  background: #dc2626;
}

.dot.pending {
  background: #94a3b8;
}

.report-empty {
  margin: 10px 0 4px;
  color: #6b7f92;
  font-size: 12px;
}

.report-list {
  margin: 8px 0 2px;
  padding: 0;
  list-style: none;
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.report-item {
  display: flex;
  gap: 8px;
}

.row-state {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

.row-state.ok {
  background: #16a34a;
}

.row-state.miss {
  background: #dc2626;
}

.row-state.pending {
  background: #94a3b8;
}

.row-body {
  min-width: 0;
}

.row-title {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: #233;
}

.row-detail {
  margin: 2px 0 0;
  font-size: 11px;
  color: #7c8ea0;
}
</style>
