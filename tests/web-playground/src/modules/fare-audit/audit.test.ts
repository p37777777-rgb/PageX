import { describe, expect, it } from 'vitest'
import { CHECK_KEYS, DISPOSITION_STATE, page1Expectations, runAudit } from './audit'
import type { AuditSnapshot } from './audit'
import {
  EXPECTED_LEDGER_TOTAL,
  EXPECTED_TOTAL,
  LEDGER_ENTRIES,
  MISSING_TKTS,
  ORDERS,
  PAGE_SIZE,
  blankAuditState,
  filterLedger,
  formatMoney,
} from './data'
import type { AuditRecord, LedgerEntry, TicketOrder } from './types'

function itemOf(results: ReturnType<typeof runAudit>, key: string) {
  const found = results.find((result) => result.key === key)
  expect(found, `判定项 ${key} 应存在`).toBeDefined()
  return found!
}

function satisfiedSnapshot(): AuditSnapshot {
  const audits = blankAuditState()
  for (const plan of page1Expectations(ORDERS, LEDGER_ENTRIES, PAGE_SIZE)) {
    const record: AuditRecord = {
      state: DISPOSITION_STATE[plan.disposition],
      actualAmount: plan.settleAmount,
      reason: plan.reasonRequired ? '渠道手续费调整扣减' : '',
    }
    audits[plan.tktNo] = record
  }
  return {
    orders: ORDERS,
    audits,
    ledgers: LEDGER_ENTRIES,
    pageSize: PAGE_SIZE,
    page1Submitted: true,
    ledgerWindowOpened: true,
  }
}

function ledgerByTkt(tktNo: string): LedgerEntry | undefined {
  return LEDGER_ENTRIES.find((entry) => entry.tktNo === tktNo)
}

function orderByTkt(tktNo: string): TicketOrder {
  const found = ORDERS.find((order) => order.tktNo === tktNo)
  expect(found, `客票 ${tktNo} 应存在`).toBeDefined()
  return found!
}

describe('数据规模与批次设计', () => {
  it('出票记录 48 笔，第 1 页为 TKT-5500 ~ TKT-5505', () => {
    expect(ORDERS).toHaveLength(EXPECTED_TOTAL)
    expect(ORDERS.slice(0, PAGE_SIZE).map((order) => order.tktNo)).toEqual([
      'TKT-5500',
      'TKT-5501',
      'TKT-5502',
      'TKT-5503',
      'TKT-5504',
      'TKT-5505',
    ])
    expect(new Set(ORDERS.map((order) => order.tktNo)).size).toBe(EXPECTED_TOTAL)
  })

  it('TKT-5501 出票 4200，流水实结 3800；TKT-5503 无流水', () => {
    expect(orderByTkt('TKT-5501').issuedAmount).toBe(4200)
    const entry = ledgerByTkt('TKT-5501')
    expect(entry).toBeDefined()
    expect(entry!.settleAmount).toBe(3800)
    expect(entry!.settleAmount).toBeLessThan(orderByTkt('TKT-5501').issuedAmount)
    expect(ledgerByTkt('TKT-5503')).toBeUndefined()
  })

  it('渠道流水共 80 笔，票号 / 流水号均唯一', () => {
    expect(LEDGER_ENTRIES).toHaveLength(EXPECTED_LEDGER_TOTAL)
    expect(new Set(LEDGER_ENTRIES.map((entry) => entry.ledgerNo)).size).toBe(EXPECTED_LEDGER_TOTAL)
    const batchTkts = LEDGER_ENTRIES.filter((entry) => entry.tktNo.startsWith('TKT-55'))
    expect(new Set(batchTkts.map((entry) => entry.tktNo)).size).toBe(batchTkts.length)
  })

  it('批次内除指定缺失票外，每张客票恰有一条流水', () => {
    const ledgerTkts = new Set(LEDGER_ENTRIES.map((entry) => entry.tktNo))
    for (const order of ORDERS) {
      const hasLedger = ledgerTkts.has(order.tktNo)
      if (MISSING_TKTS.includes(order.tktNo)) {
        expect(hasLedger, `${order.tktNo} 应无流水`).toBe(false)
      } else {
        expect(hasLedger, `${order.tktNo} 应有流水`).toBe(true)
      }
    }
  })

  it('第 1 页中 4 笔金额与流水完全一致', () => {
    const page1 = ORDERS.slice(0, PAGE_SIZE)
    const identical = page1.filter((order) => {
      const entry = ledgerByTkt(order.tktNo)
      return entry != null && entry.settleAmount === order.issuedAmount
    })
    expect(identical.map((order) => order.tktNo)).toEqual([
      'TKT-5500',
      'TKT-5502',
      'TKT-5504',
      'TKT-5505',
    ])
  })
})

describe('第 1 页期望处置计划', () => {
  const plans = page1Expectations(ORDERS, LEDGER_ENTRIES, PAGE_SIZE)

  it('共 6 条计划：4 笔吻合、1 笔差异、1 笔缺失', () => {
    expect(plans).toHaveLength(6)
    expect(plans.filter((plan) => plan.disposition === 'matched')).toHaveLength(4)
    expect(plans.filter((plan) => plan.disposition === 'discrepancy')).toHaveLength(1)
    expect(plans.filter((plan) => plan.disposition === 'missing')).toHaveLength(1)
  })

  it('TKT-5501 要求金额差异，实结 3800 且原因必填', () => {
    const plan = plans.find((item) => item.tktNo === 'TKT-5501')!
    expect(plan.disposition).toBe('discrepancy')
    expect(plan.settleAmount).toBe(3800)
    expect(plan.reasonRequired).toBe(true)
  })

  it('TKT-5503 要求标记流水缺失', () => {
    const plan = plans.find((item) => item.tktNo === 'TKT-5503')!
    expect(plan.disposition).toBe('missing')
    expect(plan.settleAmount).toBeNull()
    expect(plan.reasonRequired).toBe(false)
  })

  it('吻合单据不要求实结金额与原因', () => {
    for (const plan of plans.filter((item) => item.disposition === 'matched')) {
      expect(plan.settleAmount).toBeNull()
      expect(plan.reasonRequired).toBe(false)
    }
  })
})

describe('runAudit 判定', () => {
  it('判定项 key 与 CHECK_KEYS 一致', () => {
    const results = runAudit(satisfiedSnapshot())
    expect(results.map((result) => result.key)).toEqual([...CHECK_KEYS])
  })

  it('全部正确处置时六项判定全部通过', () => {
    const results = runAudit(satisfiedSnapshot())
    for (const result of results) {
      expect(result.result, `${result.key} 应为 ok`).toBe('ok')
    }
  })

  it('吻合单据未处置时 page1-match 未通过', () => {
    const snapshot = satisfiedSnapshot()
    snapshot.audits['TKT-5500'] = { state: '待核销', actualAmount: null, reason: '' }
    const item = itemOf(runAudit(snapshot), 'page1-matched')
    expect(item.result).toBe('miss')
    expect(item.got).toContain('TKT-5500:待核销')
  })

  it('吻合单据误标为金额差异同样不通过', () => {
    const snapshot = satisfiedSnapshot()
    snapshot.audits['TKT-5502'] = {
      state: '金额差异',
      actualAmount: 1000,
      reason: '误标',
    }
    expect(itemOf(runAudit(snapshot), 'page1-matched').result).toBe('miss')
  })

  it('差异单据实结金额错误时不通过', () => {
    const snapshot = satisfiedSnapshot()
    snapshot.audits['TKT-5501'] = {
      state: '金额差异',
      actualAmount: 4200,
      reason: '渠道费调整',
    }
    const item = itemOf(runAudit(snapshot), 'page1-discrepancy')
    expect(item.result).toBe('miss')
    expect(item.expect).toContain('3800')
  })

  it('差异单据原因为空白时不通过', () => {
    const snapshot = satisfiedSnapshot()
    snapshot.audits['TKT-5501'] = {
      state: '金额差异',
      actualAmount: 3800,
      reason: '   ',
    }
    expect(itemOf(runAudit(snapshot), 'page1-discrepancy').result).toBe('miss')
  })

  it('缺失单据误标为核销通过时不通过', () => {
    const snapshot = satisfiedSnapshot()
    snapshot.audits['TKT-5503'] = { state: '核销通过', actualAmount: null, reason: '' }
    const item = itemOf(runAudit(snapshot), 'page1-missing')
    expect(item.result).toBe('miss')
    expect(item.got).toBe('核销通过')
  })

  it('未提交当页结果时 page1-submitted 未通过', () => {
    const snapshot = satisfiedSnapshot()
    snapshot.page1Submitted = false
    expect(itemOf(runAudit(snapshot), 'page1-submitted').result).toBe('miss')
  })

  it('未打开流水台标签页时 ledger-window-opened 未通过', () => {
    const snapshot = satisfiedSnapshot()
    snapshot.ledgerWindowOpened = false
    expect(itemOf(runAudit(snapshot), 'ledger-window-opened').result).toBe('miss')
  })

  it('金额判定精确到分（3800.00 通过，3800.01 拒绝）', () => {
    const tolerant = satisfiedSnapshot()
    tolerant.audits['TKT-5501'] = {
      state: '金额差异',
      actualAmount: 3800.004, // 分位以下的浮点噪声视为一致
      reason: '渠道费调整',
    }
    expect(itemOf(runAudit(tolerant), 'page1-discrepancy').result).toBe('ok')

    const strict = satisfiedSnapshot()
    strict.audits['TKT-5501'] = {
      state: '金额差异',
      actualAmount: 3800.01,
      reason: '渠道费调整',
    }
    expect(itemOf(runAudit(strict), 'page1-discrepancy').result).toBe('miss')
  })
})

describe('状态与工具函数', () => {
  it('blankAuditState 返回全量待核销初始登记', () => {
    const blank = blankAuditState()
    expect(Object.keys(blank)).toHaveLength(EXPECTED_TOTAL)
    for (const order of ORDERS) {
      expect(blank[order.tktNo]).toEqual({ state: '待核销', actualAmount: null, reason: '' })
    }
  })

  it('filterLedger 按票号 / 流水号检索并叠加到账状态筛选', () => {
    expect(filterLedger(LEDGER_ENTRIES, 'tkt-5501', 'all')).toHaveLength(1)
    expect(filterLedger(LEDGER_ENTRIES, '  stl-2610-0001  ', 'all')).toHaveLength(1)
    expect(filterLedger(LEDGER_ENTRIES, '不存在的票号', 'all')).toHaveLength(0)

    const arrived = filterLedger(LEDGER_ENTRIES, '', '已到账')
    const transiting = filterLedger(LEDGER_ENTRIES, '', '在途')
    const pending = filterLedger(LEDGER_ENTRIES, '', '挂账')
    expect(arrived.length + transiting.length + pending.length).toBe(EXPECTED_LEDGER_TOTAL)
    expect(arrived.every((entry) => entry.arrival === '已到账')).toBe(true)
  })

  it('formatMoney 保留两位小数并带千分位', () => {
    expect(formatMoney(4200)).toBe('4,200.00')
    expect(formatMoney(3800.5)).toBe('3,800.50')
  })
})
