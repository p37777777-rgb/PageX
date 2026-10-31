<script setup lang="ts">
import { computed, provide, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { CaretBottom, DataAnalysis, Download, Odometer } from '@element-plus/icons-vue'
import { useModuleProbe } from '../../probe'
import ConditionTreeBuilder from './ConditionTreeBuilder.vue'
import { auditOnTimeLab } from './audit'
import { FLIGHT_RECORDS, INITIAL_TREE } from './data'
import {
  buildDetailCsv,
  buildPivot,
  createGroup,
  createRule,
  filterFlights,
  insertIntoGroup,
  removeNode,
  topDelayRow,
} from './engine'
import { TREE_OPS_KEY } from './types'
import type {
  FilterGroup,
  OnTimeLabSnapshot,
  PivotDimension,
  PivotRow,
  TreeOps,
} from './types'

function cloneTree(tree: FilterGroup): FilterGroup {
  return JSON.parse(JSON.stringify(tree)) as FilterGroup
}

/* ---------- 页面状态 ---------- */
const root = ref<FilterGroup>(cloneTree(INITIAL_TREE))
const dimension = ref<PivotDimension>('region')
const pivotRows = ref<PivotRow[] | null>(null)
const drilledKey = ref<string | null>(null)
const exportedKey = ref<string | null>(null)

const drawerVisible = ref(false)
const drawerRow = ref<PivotRow | null>(null)

const worstRow = computed(() => topDelayRow(pivotRows.value ?? []))
const hitCount = computed(() =>
  pivotRows.value == null ? 0 : pivotRows.value.reduce((sum, row) => sum + row.flightCount, 0),
)

/* ---------- 条件树操作 ---------- */
const treeOps: TreeOps = {
  addRule(groupId) {
    insertIntoGroup(root.value, groupId, createRule('departureSlot'))
  },
  addSubgroup(groupId) {
    insertIntoGroup(root.value, groupId, createGroup())
  },
  removeNode(nodeId) {
    removeNode(root.value, nodeId)
  },
}
provide(TREE_OPS_KEY, treeOps)

/* ---------- 透视计算 ---------- */
function runPivot() {
  const matched = filterFlights(FLIGHT_RECORDS, root.value)
  pivotRows.value = buildPivot(matched, dimension.value)
  if (pivotRows.value.length === 0) {
    ElMessage.warning('当前条件未命中任何航班，请调整条件树后重试')
  } else {
    ElMessage.success(`命中 ${matched.length} 班，聚合出 ${pivotRows.value.length} 个维度取值`)
  }
}

function dimensionLabel(value: PivotDimension): string {
  return value === 'region' ? '航线区域' : '出港时段'
}

/* ---------- 明细下钻与导出 ---------- */
function openDetail(row: PivotRow) {
  drilledKey.value = row.key
  drawerRow.value = row
  drawerVisible.value = true
}

function exportDetail() {
  const row = drawerRow.value
  if (row == null) return
  // 加 BOM 便于 Excel 直接打开中文 CSV
  const blob = new Blob([`\uFEFF${buildDetailCsv(row.records)}`], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `准点问题明细_${row.key}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  exportedKey.value = row.key
  ElMessage.success(`「${row.key}」明细报表已导出`)
}

function rowClass({ row }: { row: PivotRow }): string {
  return worstRow.value != null && row.key === worstRow.value.key ? 'otl-worst-row' : ''
}

/* ---------- 体检探针 ---------- */
function snapshot(): OnTimeLabSnapshot {
  return {
    root: root.value,
    pivotRows: pivotRows.value,
    drilledKey: drilledKey.value,
    exportedKey: exportedKey.value,
  }
}

useModuleProbe('on-time-lab', {
  runChecks: () => auditOnTimeLab(snapshot()),
  resetModule: () => {
    root.value = cloneTree(INITIAL_TREE)
    dimension.value = 'region'
    pivotRows.value = null
    drilledKey.value = null
    exportedKey.value = null
    drawerVisible.value = false
    drawerRow.value = null
  },
})
</script>

<template>
  <div class="otl">
    <section class="otl-builder">
      <div class="otl-builder-head">
        <div class="otl-builder-title">
          <el-icon :size="16" color="#0e7490"><Odometer /></el-icon>
          <strong>筛选条件编排</strong>
          <span class="otl-builder-sub">支持 AND / OR 任意深度嵌套</span>
        </div>
        <div class="otl-builder-actions">
          <el-select v-model="dimension" size="default" class="otl-dimension">
            <el-option value="region" label="透视维度：航线区域" />
            <el-option value="departureSlot" label="透视维度：出港时段" />
          </el-select>
          <el-button type="primary" color="#0e7490" @click="runPivot">
            <el-icon><DataAnalysis /></el-icon>&nbsp;执行透视计算
          </el-button>
        </div>
      </div>
      <div class="otl-builder-body">
        <ConditionTreeBuilder :group="root" :depth="0" />
      </div>
    </section>

    <section class="otl-result">
      <div class="otl-result-head">
        <strong>维度透视矩阵</strong>
        <span v-if="pivotRows != null" class="otl-result-meta">
          命中 {{ hitCount }} 班 · {{ pivotRows.length }} 个{{ dimensionLabel(dimension) }}取值
        </span>
        <span v-else class="otl-result-meta">编排好条件后点击「执行透视计算」生成矩阵</span>
        <span class="otl-head-gap" />
        <span v-if="worstRow" class="otl-worst-tag">
          平均延误率最高：{{ worstRow.key }}（{{ worstRow.avgDelayRate }}%）
        </span>
      </div>

      <el-table
        v-if="pivotRows != null"
        :data="pivotRows"
        :row-class-name="rowClass"
        size="default"
        class="otl-table"
      >
        <el-table-column :label="dimensionLabel(dimension)" prop="key" min-width="140" />
        <el-table-column label="航班数" prop="flightCount" width="100" align="right" />
        <el-table-column label="平均延误率(%)" width="150" align="right">
          <template #default="{ row }">
            <span :class="{ 'otl-delay-cell': row.key === worstRow?.key }">
              {{ row.avgDelayRate.toFixed(1) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="平均载客率(%)" width="150" align="right">
          <template #default="{ row }">{{ row.avgLoadFactor.toFixed(1) }}</template>
        </el-table-column>
        <el-table-column label="投诉合计(次)" prop="totalComplaints" width="130" align="right" />
        <el-table-column label="操作" width="130" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">
              展开明细<el-icon class="otl-caret"><CaretBottom /></el-icon>
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="尚未执行透视计算" :image-size="72" />
    </section>

    <el-drawer
      v-model="drawerVisible"
      :title="drawerRow ? `「${drawerRow.key}」问题航班明细 · ${drawerRow.records.length} 班` : '明细'"
      size="46%"
    >
      <template v-if="drawerRow">
        <div class="otl-drawer-meta">
          <span>航班数 {{ drawerRow.flightCount }}</span>
          <span>平均延误率 {{ drawerRow.avgDelayRate.toFixed(1) }}%</span>
          <span>平均载客率 {{ drawerRow.avgLoadFactor.toFixed(1) }}%</span>
          <span>投诉合计 {{ drawerRow.totalComplaints }} 次</span>
        </div>
        <el-table :data="drawerRow.records" size="small" border>
          <el-table-column label="航班号" prop="flightNo" width="100" />
          <el-table-column label="出港时段" prop="departureSlot" width="100" />
          <el-table-column label="航线区域" prop="region" width="100" />
          <el-table-column label="平均载客率(%)">
            <template #default="{ row }">{{ row.loadFactor.toFixed(1) }}</template>
          </el-table-column>
          <el-table-column label="延误率(%)">
            <template #default="{ row }">{{ row.delayRate.toFixed(1) }}</template>
          </el-table-column>
          <el-table-column label="旅客投诉(次)" prop="complaints" width="110" align="right" />
        </el-table>
        <div class="otl-drawer-foot">
          <el-button type="primary" color="#0e7490" @click="exportDetail">
            <el-icon><Download /></el-icon>&nbsp;导出明细报表
          </el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.otl {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #f2f6f8;
}

/* ---------- 条件编排区 ---------- */
.otl-builder {
  flex: none;
  max-height: 52%;
  display: flex;
  flex-direction: column;
  margin: 14px 18px 0;
  background: #fff;
  border: 1px solid #e2ecf0;
  border-radius: 10px;
}

.otl-builder-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #edf3f6;
}

.otl-builder-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #24404d;
}

.otl-builder-sub {
  font-size: 12px;
  font-weight: 400;
  color: #8aa0ad;
}

.otl-builder-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.otl-dimension {
  width: 190px;
}

.otl-builder-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px 14px;
}

/* ---------- 透视矩阵区 ---------- */
.otl-result {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin: 14px 18px 18px;
  background: #fff;
  border: 1px solid #e2ecf0;
  border-radius: 10px;
  padding: 12px 16px 14px;
}

.otl-result-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  font-size: 14px;
  color: #24404d;
}

.otl-result-meta {
  font-size: 12px;
  font-weight: 400;
  color: #8aa0ad;
}

.otl-head-gap {
  flex: 1;
}

.otl-worst-tag {
  font-size: 12px;
  color: #b4232a;
  background: rgba(180, 35, 42, 0.08);
  border: 1px solid rgba(180, 35, 42, 0.25);
  border-radius: 999px;
  padding: 3px 10px;
}

.otl-table {
  flex: 1;
  min-height: 0;
}

.otl-delay-cell {
  color: #b4232a;
  font-weight: 700;
}

:deep(.otl-worst-row) {
  background: #fdf6f6;
}

.otl-caret {
  margin-left: 2px;
}

/* ---------- 抽屉 ---------- */
.otl-drawer-meta {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 12.5px;
  color: #5a7482;
}

.otl-drawer-foot {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}
</style>
