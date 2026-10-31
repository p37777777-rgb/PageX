<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import Chart from 'chart.js/auto'
import type { Chart as ChartInstance } from 'chart.js'
import { useModuleProbe } from '../../probe'
import { runAudit } from './audit'
import {
  CHANNEL_OPTIONS,
  CHANNEL_TEXT,
  DEFAULT_FILTERS,
  MONTH_LABELS,
  ROUTES,
  ROUTE_TYPE_OPTIONS,
  ROUTE_TYPE_TEXT,
  SEASON_TAG,
  filterLegs,
  formatPax,
  formatRevenue,
  monthlyRevenue,
  peakMonth,
  routeAggregates,
  routeById,
  summarize,
} from './model'
import type { DashboardFilters, RouteType } from './model'

type TagKind = 'primary' | 'success' | 'warning'

const filters = reactive<DashboardFilters>({ ...DEFAULT_FILTERS })

/* 交互痕迹：只增不减，供体检探针只读，重置筛选不擦除 */
const trace = {
  channelSeen: new Set([filters.channel]),
  routeTypeSeen: new Set([filters.routeType]),
  routeSearchUsed: false,
  routePicked: '',
}

watch(
  () => filters.channel,
  (value) => trace.channelSeen.add(value),
)
watch(
  () => filters.routeType,
  (value) => trace.routeTypeSeen.add(value),
)
watch(
  () => filters.routeId,
  (value) => {
    trace.routePicked = value ?? ''
  },
)

const routeKeyword = ref('')

function filterRouteOptions(query: string) {
  const keyword = query.trim()
  if (keyword) trace.routeSearchUsed = true
  routeKeyword.value = keyword
}

function onRouteDropdown(visible: boolean) {
  if (!visible) routeKeyword.value = ''
}

const routeOptions = computed(() =>
  ROUTES.filter((route) => !routeKeyword.value || route.name.includes(routeKeyword.value)),
)

const legs = computed(() => filterLegs(filters))
const kpi = computed(() => summarize(legs.value))
const trend = computed(() => monthlyRevenue(legs.value))
const rankedRoutes = computed(() => routeAggregates(legs.value))
const topRoutes = computed(() => rankedRoutes.value.slice(0, 8))
const tableRows = computed(() => rankedRoutes.value)

const scopeText = computed(() => {
  const route = filters.routeId ? (routeById(filters.routeId)?.name ?? '未知航线') : '全部航线'
  return `${CHANNEL_TEXT[filters.channel]} · ${ROUTE_TYPE_TEXT[filters.routeType]} · ${route}`
})

function routePeakLabel(routeId: string): string {
  const peak = peakMonth(
    filterLegs({ channel: 'all', routeType: 'all', routeId }),
  )
  return peak.label || '—'
}

function typeTag(type: RouteType): TagKind {
  if (type === 'domestic') return 'primary'
  if (type === 'international') return 'warning'
  return 'success'
}

function resetFilters() {
  Object.assign(filters, DEFAULT_FILTERS)
  routeKeyword.value = ''
}

/* ---------------- chart.js 图表 ---------------- */

const trendCanvas = ref<HTMLCanvasElement>()
const rankCanvas = ref<HTMLCanvasElement>()

let trendChart: ChartInstance<'line'> | null = null
let rankChart: ChartInstance<'bar'> | null = null
let chartsReady = 0

function refreshCharts() {
  if (trendChart) {
    trendChart.data.labels = MONTH_LABELS
    trendChart.data.datasets[0].data = trend.value
    trendChart.update()
  }
  if (rankChart) {
    rankChart.data.labels = topRoutes.value.map((row) => row.name)
    rankChart.data.datasets[0].data = topRoutes.value.map((row) => row.revenueWan)
    rankChart.update()
  }
}

onMounted(() => {
  if (trendCanvas.value) {
    trendChart = new Chart(trendCanvas.value, {
      type: 'line',
      data: {
        labels: MONTH_LABELS,
        datasets: [
          {
            label: '客运收入（万元）',
            data: trend.value,
            borderColor: '#0e7490',
            backgroundColor: 'rgba(14, 116, 144, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 2.5,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false } } },
      },
    })
    chartsReady += 1
  }

  if (rankCanvas.value) {
    rankChart = new Chart(rankCanvas.value, {
      type: 'bar',
      data: {
        labels: topRoutes.value.map((row) => row.name),
        datasets: [
          {
            label: '客运收入（万元）',
            data: topRoutes.value.map((row) => row.revenueWan),
            backgroundColor: '#0891b2',
            borderRadius: 4,
            maxBarThickness: 20,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(15, 23, 42, 0.06)' } },
          y: { grid: { display: false } },
        },
      },
    })
    chartsReady += 1
  }

  refreshCharts()
})

watch([trend, topRoutes], refreshCharts)

onBeforeUnmount(() => {
  trendChart?.destroy()
  rankChart?.destroy()
  trendChart = null
  rankChart = null
  chartsReady = 0
})

/* ---------------- 体检探针 ---------------- */

function runChecks() {
  return runAudit({
    channelSeen: [...trace.channelSeen],
    routeTypeSeen: [...trace.routeTypeSeen],
    routeSearchUsed: trace.routeSearchUsed,
    routePicked: trace.routePicked,
    chartCount: chartsReady,
    tableRowCount: tableRows.value.length,
  })
}

useModuleProbe('route-pulse', {
  runChecks,
  resetModule: resetFilters,
})
</script>

<template>
  <div class="route-pulse">
    <header class="board-head">
      <h2 class="board-title">航线经营洞察</h2>
      <el-tag size="small" effect="dark" class="season-tag">{{ SEASON_TAG }}</el-tag>
      <span class="board-sub">口径：客运定期航班 · 月度结算关账数据</span>
    </header>

    <section class="filter-bar">
      <div class="filter-item">
        <label>销售渠道</label>
        <el-select v-model="filters.channel" class="sel-channel">
          <el-option
            v-for="option in CHANNEL_OPTIONS"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </div>
      <div class="filter-item">
        <label>航线类型</label>
        <el-select v-model="filters.routeType" class="sel-type">
          <el-option
            v-for="option in ROUTE_TYPE_OPTIONS"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </div>
      <div class="filter-item">
        <label>航线</label>
        <el-select
          v-model="filters.routeId"
          class="sel-route"
          filterable
          clearable
          placeholder="输入关键字搜索航线"
          :filter-method="filterRouteOptions"
          :prefix-icon="Search"
          @visible-change="onRouteDropdown"
        >
          <el-option
            v-for="route in routeOptions"
            :key="route.id"
            :label="route.name"
            :value="route.id"
          />
        </el-select>
      </div>
      <el-button text type="primary" @click="resetFilters">恢复默认</el-button>
      <span class="filter-scope">当前口径：{{ scopeText }}</span>
    </section>

    <section class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">客运总收入</div>
        <div class="kpi-value">{{ formatRevenue(kpi.revenueWan) }}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">总旅客量</div>
        <div class="kpi-value">{{ formatPax(kpi.pax) }}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">平均客座率</div>
        <div class="kpi-value">{{ kpi.loadPct }}<span class="kpi-unit">%</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">在飞航线数</div>
        <div class="kpi-value">{{ kpi.activeRoutes }}<span class="kpi-unit">条</span></div>
      </div>
    </section>

    <section class="chart-grid">
      <div class="panel">
        <div class="panel-title">月度客运收入趋势</div>
        <div class="chart-box">
          <canvas ref="trendCanvas" />
        </div>
      </div>
      <div class="panel">
        <div class="panel-title">航线收入 Top 8</div>
        <div class="chart-box">
          <canvas ref="rankCanvas" />
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">航线明细</div>
      <el-table :data="tableRows" size="small" stripe>
        <el-table-column label="航线" prop="name" min-width="150" />
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="typeTag(row.type)" effect="plain">
              {{ ROUTE_TYPE_TEXT[row.type as RouteType] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="客运收入" width="130">
          <template #default="{ row }">{{ formatRevenue(row.revenueWan) }}</template>
        </el-table-column>
        <el-table-column label="旅客量" width="120">
          <template #default="{ row }">{{ formatPax(row.pax) }}</template>
        </el-table-column>
        <el-table-column label="平均客座率" width="100">
          <template #default="{ row }">{{ row.loadPct }}%</template>
        </el-table-column>
        <el-table-column label="旺季月份" min-width="100">
          <template #default="{ row }">{{ routePeakLabel(row.routeId) }}</template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<style scoped>
.route-pulse {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 1240px;
  margin-inline: auto;
}

.board-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.board-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #0e7490;
  letter-spacing: 0.5px;
}

.season-tag {
  background-color: #0e7490;
}

.board-sub {
  font-size: 12px;
  color: #94a3b8;
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.filter-item label {
  font-size: 13px;
  color: #64748b;
  white-space: nowrap;
}

.sel-channel {
  width: 120px;
}

.sel-type {
  width: 110px;
}

.sel-route {
  width: 220px;
}

.filter-scope {
  margin-left: auto;
  font-size: 12px;
  color: #0e7490;
  background: rgba(14, 116, 144, 0.08);
  padding: 4px 10px;
  border-radius: 999px;
  white-space: nowrap;
}

.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}

.kpi-card {
  padding: 14px 18px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-left: 3px solid #0e7490;
  border-radius: 10px;
}

.kpi-label {
  font-size: 13px;
  color: #64748b;
}

.kpi-value {
  margin-top: 6px;
  font-size: 22px;
  font-weight: 600;
  color: #0f172a;
}

.kpi-unit {
  margin-left: 4px;
  font-size: 12px;
  font-weight: 400;
  color: #94a3b8;
}

.chart-grid {
  display: grid;
  grid-template-columns: 7fr 5fr;
  gap: 14px;
}

.panel {
  padding: 14px 16px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}

.panel-title {
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}

.chart-box {
  position: relative;
  height: 260px;
}

@media (max-width: 960px) {
  .kpi-row {
    grid-template-columns: repeat(2, 1fr);
  }

  .chart-grid {
    grid-template-columns: 1fr;
  }
}
</style>
