<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Link } from '@element-plus/icons-vue'
import { useModuleProbe } from '../../probe'
import { runAudit } from './audit'
import {
  BATCH_NO,
  LEDGER_ENTRIES,
  ORDERS,
  PAGE_SIZE,
  blankAuditState,
  formatMoney,
} from './data'
import type { SettleState, TicketOrder } from './types'

/* ---------------- 核销登记状态 ---------------- */

const auditState = reactive(blankAuditState())
const currentPage = ref(1)
const submittedPages = reactive(new Set<number>())
const ledgerWindowOpened = ref(false)

function recordOf(order: TicketOrder) {
  return auditState[order.tktNo]
}

function pageOf(order: TicketOrder): number {
  return Math.floor(ORDERS.findIndex((item) => item.tktNo === order.tktNo) / PAGE_SIZE) + 1
}

const pagedOrders = computed(() =>
  ORDERS.slice((currentPage.value - 1) * PAGE_SIZE, currentPage.value * PAGE_SIZE),
)

const statusCounts = computed(() => {
  const counts: Record<SettleState, number> = { 待核销: 0, 核销通过: 0, 金额差异: 0, 流水缺失: 0 }
  for (const order of ORDERS) counts[auditState[order.tktNo].state] += 1
  return counts
})

const pageDisposedCount = computed(
  () => pagedOrders.value.filter((order) => recordOf(order).state !== '待核销').length,
)

const pageSubmitted = computed(() => submittedPages.has(currentPage.value))

const canSubmit = computed(
  () => !pageSubmitted.value && pageDisposedCount.value === pagedOrders.value.length,
)

/* ---------------- 处置动作 ---------------- */

function isFrozen(order: TicketOrder): boolean {
  return submittedPages.has(pageOf(order))
}

function approve(order: TicketOrder) {
  auditState[order.tktNo] = { state: '核销通过', actualAmount: null, reason: '' }
}

function markMissing(order: TicketOrder) {
  auditState[order.tktNo] = { state: '流水缺失', actualAmount: null, reason: '' }
}

const diffDialog = reactive({ visible: false, tktNo: '', amountText: '', reason: '' })

function openDiff(order: TicketOrder) {
  const record = recordOf(order)
  diffDialog.tktNo = order.tktNo
  diffDialog.amountText = record.actualAmount == null ? '' : String(record.actualAmount)
  diffDialog.reason = record.state === '金额差异' ? record.reason : ''
  diffDialog.visible = true
}

function confirmDiff() {
  const amount = Number(diffDialog.amountText)
  if (diffDialog.amountText.trim() === '' || Number.isNaN(amount) || amount < 0) {
    ElMessage.warning('请填写有效的渠道实结金额')
    return
  }
  if (!diffDialog.reason.trim()) {
    ElMessage.warning('请填写差异原因')
    return
  }
  auditState[diffDialog.tktNo] = {
    state: '金额差异',
    actualAmount: Math.round(amount * 100) / 100,
    reason: diffDialog.reason.trim(),
  }
  diffDialog.visible = false
  ElMessage.success(`${diffDialog.tktNo} 金额差异已登记`)
}

function submitPage() {
  if (!canSubmit.value) return
  for (const order of pagedOrders.value) submittedPages.add(pageOf(order))
  ElMessage.success(`第 ${currentPage.value} 页核销结果已提交结算中心`)
}

function openLedgerWindow() {
  ledgerWindowOpened.value = true
  window.open('/fare-audit/ledger', '_blank')
}

/* ---------------- 状态展示 ---------------- */

const stateTagType: Record<SettleState, 'info' | 'success' | 'warning' | 'danger'> = {
  待核销: 'info',
  核销通过: 'success',
  金额差异: 'warning',
  流水缺失: 'danger',
}

/* ---------------- 体检探针 ---------------- */

function runChecks() {
  return runAudit({
    orders: ORDERS,
    audits: auditState,
    ledgers: LEDGER_ENTRIES,
    pageSize: PAGE_SIZE,
    page1Submitted: submittedPages.has(1),
    ledgerWindowOpened: ledgerWindowOpened.value,
  })
}

function resetModule() {
  Object.assign(auditState, blankAuditState())
  submittedPages.clear()
  currentPage.value = 1
  diffDialog.visible = false
}

useModuleProbe('fare-audit', { runChecks, resetModule })
</script>

<template>
  <div class="fare-audit">
    <header class="fa-toolbar">
      <div class="fa-head">
        <h2 class="fa-title">直销出票核销台</h2>
        <el-tag effect="dark" size="small" class="fa-batch">结算批次 {{ BATCH_NO }}</el-tag>
        <div class="fa-stats">
          <span v-for="(count, state) in statusCounts" :key="state" class="fa-stat">
            <i class="fa-dot" :class="`is-${stateTagType[state as SettleState]}`" />
            {{ state }} <b>{{ count }}</b>
          </span>
        </div>
      </div>
      <el-button type="primary" plain :icon="Link" @click="openLedgerWindow">
        在新标签页打开渠道流水台
      </el-button>
    </header>

    <div class="fa-table">
      <el-table :data="pagedOrders" height="100%" stripe>
        <el-table-column label="票号" prop="tktNo" width="110">
          <template #default="{ row }">
            <span class="fa-mono">{{ row.tktNo }}</span>
          </template>
        </el-table-column>
        <el-table-column label="PNR" prop="pnr" width="90">
          <template #default="{ row }">
            <span class="fa-mono">{{ row.pnr }}</span>
          </template>
        </el-table-column>
        <el-table-column label="航线" prop="route" min-width="170" />
        <el-table-column label="旅客" prop="passenger" width="100" />
        <el-table-column label="出票金额" width="120" align="right">
          <template #default="{ row }">¥ {{ formatMoney(row.issuedAmount) }}</template>
        </el-table-column>
        <el-table-column label="结算状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="stateTagType[recordOf(row).state]" effect="light">
              {{ recordOf(row).state }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="核销操作" width="220" align="center">
          <template #default="{ row }">
            <el-button
              link
              type="success"
              :disabled="isFrozen(row)"
              @click="approve(row)"
            >
              核销通过
            </el-button>
            <el-button
              link
              type="warning"
              :disabled="isFrozen(row)"
              @click="openDiff(row)"
            >
              标记差异
            </el-button>
            <el-button
              link
              type="danger"
              :disabled="isFrozen(row)"
              @click="markMissing(row)"
            >
              流水缺失
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <footer class="fa-footer">
      <div class="fa-progress">
        <template v-if="pageSubmitted">
          <el-tag size="small" type="success" effect="plain">本页核销结果已提交</el-tag>
        </template>
        <template v-else>
          <span>本页处置进度</span>
          <el-progress
            :percentage="(pageDisposedCount / pagedOrders.length) * 100"
            :stroke-width="8"
            :show-text="false"
            class="fa-progress-bar"
          />
          <span class="fa-progress-text">{{ pageDisposedCount }}/{{ pagedOrders.length }}</span>
        </template>
      </div>
      <el-pagination
        v-model:current-page="currentPage"
        background
        layout="total, prev, pager, next"
        :total="ORDERS.length"
        :page-size="PAGE_SIZE"
      />
      <el-button type="primary" :disabled="!canSubmit" @click="submitPage">
        提交当页核销结果
      </el-button>
    </footer>

    <el-dialog
      v-model="diffDialog.visible"
      title="登记金额差异"
      width="440px"
      :close-on-click-modal="false"
    >
      <div class="fa-diff-row">
        <span class="fa-diff-label">客票票号</span>
        <span class="fa-mono">{{ diffDialog.tktNo }}</span>
      </div>
      <div class="fa-diff-row">
        <span class="fa-diff-label">渠道实结金额（元）</span>
        <el-input
          v-model="diffDialog.amountText"
          placeholder="以渠道流水结算金额为准"
          clearable
        />
      </div>
      <div class="fa-diff-row">
        <span class="fa-diff-label">差异原因</span>
        <el-input
          v-model="diffDialog.reason"
          type="textarea"
          :rows="3"
          maxlength="120"
          show-word-limit
          placeholder="例如渠道手续费调整、退改扣款等"
        />
      </div>
      <template #footer>
        <el-button @click="diffDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="confirmDiff">确认登记</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.fare-audit {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  padding: 14px 20px 16px;
  background: #f6f9fb;
}

.fa-toolbar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.fa-head {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.fa-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: #0e7490;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.fa-batch {
  background-color: #0e7490;
}

.fa-stats {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 12.5px;
  color: #64748b;
  white-space: nowrap;
}

.fa-stat b {
  color: #0f172a;
}

.fa-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 4px;
  vertical-align: 1px;
}

.fa-dot.is-info {
  background: #94a3b8;
}

.fa-dot.is-success {
  background: #22c55e;
}

.fa-dot.is-warning {
  background: #f59e0b;
}

.fa-dot.is-danger {
  background: #ef4444;
}

.fa-table {
  flex: 1;
  min-height: 0;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}

.fa-mono {
  font-family: 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace;
  font-size: 12.5px;
}

.fa-footer {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 12px;
}

.fa-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: #64748b;
  min-width: 200px;
}

.fa-progress-bar {
  width: 120px;
}

.fa-progress-text {
  color: #0e7490;
  font-weight: 600;
}

.fa-diff-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}

.fa-diff-label {
  font-size: 13px;
  color: #475569;
}
</style>
