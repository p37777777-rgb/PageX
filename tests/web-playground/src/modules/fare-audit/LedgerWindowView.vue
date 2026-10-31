<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RefreshLeft, Search } from '@element-plus/icons-vue'
import {
  BATCH_NO,
  EXPECTED_LEDGER_TOTAL,
  LEDGER_ENTRIES,
  LEDGER_PAGE_SIZE,
  filterLedger,
  formatMoney,
} from './data'
import type { ArrivalStatus } from './types'

const keyword = ref('')
const arrival = ref<ArrivalStatus | 'all'>('all')
const currentPage = ref(1)

const arrivalOptions: Array<{ value: ArrivalStatus | 'all'; label: string }> = [
  { value: 'all', label: '全部到账状态' },
  { value: '已到账', label: '已到账' },
  { value: '在途', label: '在途' },
  { value: '挂账', label: '挂账' },
]

const filteredEntries = computed(() =>
  filterLedger(LEDGER_ENTRIES, keyword.value, arrival.value),
)

const pagedEntries = computed(() =>
  filteredEntries.value.slice(
    (currentPage.value - 1) * LEDGER_PAGE_SIZE,
    currentPage.value * LEDGER_PAGE_SIZE,
  ),
)

watch([keyword, arrival], () => {
  currentPage.value = 1
})

function resetFilters() {
  keyword.value = ''
  arrival.value = 'all'
  currentPage.value = 1
}

const arrivalTagType: Record<ArrivalStatus, 'success' | 'warning' | 'info'> = {
  已到账: 'success',
  在途: 'warning',
  挂账: 'info',
}
</script>

<template>
  <div class="ledger-window">
    <header class="lw-head">
      <div class="lw-title-group">
        <h2 class="lw-title">渠道结算流水台</h2>
        <el-tag effect="dark" size="small" class="lw-account">
          银联收单渠道 · 结算账户 · 批次 {{ BATCH_NO }}
        </el-tag>
      </div>
      <span class="lw-total">共 {{ EXPECTED_LEDGER_TOTAL }} 笔交易流水</span>
    </header>

    <div class="lw-filter">
      <el-input
        v-model="keyword"
        class="lw-search"
        placeholder="按票号或流水号检索"
        clearable
        :prefix-icon="Search"
      />
      <el-select v-model="arrival" class="lw-arrival">
        <el-option
          v-for="option in arrivalOptions"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
      <span class="lw-hit">命中 {{ filteredEntries.length }} 笔</span>
      <el-button text type="primary" :icon="RefreshLeft" @click="resetFilters">
        重置条件
      </el-button>
    </div>

    <div class="lw-table">
      <el-table :data="pagedEntries" height="100%" stripe>
        <el-table-column label="流水号" width="130">
          <template #default="{ row }">
            <span class="lw-mono">{{ row.ledgerNo }}</span>
          </template>
        </el-table-column>
        <el-table-column label="票号" width="110">
          <template #default="{ row }">
            <span class="lw-mono">{{ row.tktNo }}</span>
          </template>
        </el-table-column>
        <el-table-column label="交易时间" prop="tradedAt" min-width="150">
          <template #default="{ row }">
            <span class="lw-mono">{{ row.tradedAt }}</span>
          </template>
        </el-table-column>
        <el-table-column label="结算金额" width="120" align="right">
          <template #default="{ row }">¥ {{ formatMoney(row.settleAmount) }}</template>
        </el-table-column>
        <el-table-column label="渠道费" width="100" align="right">
          <template #default="{ row }">{{ formatMoney(row.channelFee) }}</template>
        </el-table-column>
        <el-table-column label="到账状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="arrivalTagType[row.arrival as ArrivalStatus]" effect="light">
              {{ row.arrival }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <footer class="lw-footer">
      <span class="lw-hint">结算金额为渠道实际入账净额，渠道费已从中扣除</span>
      <el-pagination
        v-model:current-page="currentPage"
        background
        layout="total, prev, pager, next"
        :total="filteredEntries.length"
        :page-size="LEDGER_PAGE_SIZE"
      />
    </footer>
  </div>
</template>

<style scoped>
.ledger-window {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  padding: 14px 20px 16px;
  background: #f6f9fb;
}

.lw-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.lw-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.lw-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: #0e7490;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.lw-account {
  background-color: #0e7490;
}

.lw-total {
  font-size: 12.5px;
  color: #64748b;
  white-space: nowrap;
}

.lw-filter {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  margin-bottom: 12px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}

.lw-search {
  width: 240px;
}

.lw-arrival {
  width: 150px;
}

.lw-hit {
  font-size: 12.5px;
  color: #0e7490;
  background: rgba(14, 116, 144, 0.08);
  padding: 3px 10px;
  border-radius: 999px;
  white-space: nowrap;
}

.lw-table {
  flex: 1;
  min-height: 0;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}

.lw-mono {
  font-family: 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace;
  font-size: 12.5px;
}

.lw-footer {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 12px;
}

.lw-hint {
  font-size: 12px;
  color: #94a3b8;
}
</style>
