import { describe, expect, it } from 'vitest'
import {
  BRIEF_TITLE,
  MIN_BODY_CHARS,
  SECTION_RULES,
  auditManuals,
  countEffectiveChars,
  extractSearchable,
  findBriefDoc,
} from './audit'
import type { AuthoredManual } from './types'

function makeDoc(overrides: Partial<AuthoredManual> = {}): AuthoredManual {
  const text = [
    '概述：本简报汇总 A350 引进进展。',
    'Q3 核心指标：航班正常率 89.42%，执行架次 42,318，行李差错率 0.42‰，旅客投诉 217 件次，NPS 46。',
    '手册变更：OEB-2026-03 强制改装，OEB-2024-11 于 2026-11-30 废止。',
    '风险与决策：改装窗口与验证飞行重叠，决策采用备份运力缓解。',
    '行动项：分拣线扩容复核，负责人白鹿原，截止 2026-09-12。',
    'Q4 训练预算 2,150 万元，过渡课程专项 880 万元。',
  ].join('')
  return {
    id: 'm-1',
    title: BRIEF_TITLE,
    labels: ['评审', '简报'],
    richText: `<p>${text}</p>`,
    plainText: text,
    charTotal: text.length,
    savedAt: 1_760_000_000_000,
    revisedAt: 1_760_000_000_000,
    ...overrides,
  }
}

describe('findBriefDoc', () => {
  it('匹配精确标题并容忍首尾空白', () => {
    expect(findBriefDoc([makeDoc({ title: `  ${BRIEF_TITLE} ` })])?.id).toBe('m-1')
  })

  it('相似但不同的标题不匹配', () => {
    expect(findBriefDoc([makeDoc({ title: `${BRIEF_TITLE}（草稿）` })])).toBeUndefined()
    expect(findBriefDoc([makeDoc({ title: 'A350 机队引进评审报告' })])).toBeUndefined()
  })
})

describe('extractSearchable / countEffectiveChars', () => {
  it('剥离 HTML 标签后统计', () => {
    const doc = makeDoc({ richText: '<h2>概述</h2><p>预算 100 万元</p>', plainText: '' })
    expect(extractSearchable(doc)).not.toContain('<p>')
    expect(countEffectiveChars(doc)).toBe(
      '概述预算100万元'.length + BRIEF_TITLE.replace(/\s/g, '').length,
    )
  })

  it('空白不计入有效字数', () => {
    const doc = makeDoc({ richText: 'a  b\tc', plainText: '' })
    expect(countEffectiveChars(doc)).toBe(BRIEF_TITLE.replace(/\s/g, '').length + 3)
  })
})

describe('auditManuals', () => {
  it('空文档列表：判定项 miss，浏览项 pending', () => {
    const items = auditManuals({ authored: [] })
    const byKey = new Map(items.map((item) => [item.key, item]))
    expect(byKey.get('browse-reading')?.result).toBe('pending')
    expect(byKey.get('collect-info')?.result).toBe('pending')
    expect(byKey.get('brief-title')?.result).toBe('miss')
    expect(byKey.get('brief-labels')?.result).toBe('miss')
    expect(byKey.get('body-length')?.result).toBe('miss')
    for (const rule of SECTION_RULES) {
      expect(byKey.get(rule.key)?.result).toBe('miss')
    }
    expect(byKey.get('doc-saved')?.result).toBe('miss')
  })

  it('合规简报：所有可判定项全部通过', () => {
    const items = auditManuals({ authored: [makeDoc()] })
    for (const item of items) {
      if (item.key === 'browse-reading' || item.key === 'collect-info') {
        expect(item.result).toBe('pending')
      } else {
        expect(item.result, item.key).toBe('ok')
      }
    }
  })

  it('标题相符但标签不足时标签项 miss', () => {
    const items = auditManuals({ authored: [makeDoc({ labels: ['简报'] })] })
    const byKey = new Map(items.map((item) => [item.key, item]))
    expect(byKey.get('brief-title')?.result).toBe('ok')
    expect(byKey.get('brief-labels')?.result).toBe('miss')
  })

  it('正文过短时长度项 miss', () => {
    const doc = makeDoc({ richText: '<p>概述</p>', plainText: '概述' })
    expect(countEffectiveChars(doc)).toBeLessThan(MIN_BODY_CHARS)
    const byKey = new Map(
      auditManuals({ authored: [doc] }).map((item) => [item.key, item]),
    )
    expect(byKey.get('body-length')?.result).toBe('miss')
    expect(byKey.get('brief-title')?.result).toBe('ok')
  })

  it('缺少某主题关键词时仅对应分组 miss', () => {
    const text = '概述：引进评审。Q3 正常率 89%。OEB-2024-11 废止。风险可控。行动项负责人与截止齐备。'
    const doc = makeDoc({
      richText: `<p>${text}</p>`,
      plainText: text,
      charTotal: text.length,
    })
    const byKey = new Map(
      auditManuals({ authored: [doc] }).map((item) => [item.key, item]),
    )
    expect(byKey.get('sec-budget')?.result).toBe('miss')
    expect(byKey.get('sec-overview')?.result).toBe('ok')
    expect(byKey.get('sec-metrics')?.result).toBe('ok')
    expect(byKey.get('sec-actions')?.result).toBe('ok')
  })

  it('富文本内关键词同样可命中', () => {
    const text = '概述。正常率与架次与投诉与 NPS。废止与改装。风险与决策。行动项负责人截止。预算万元经费。'
    const doc = makeDoc({
      richText: `<ul><li>${text.split('。').join('</li><li>')}</li></ul>`,
      plainText: '',
    })
    const byKey = new Map(
      auditManuals({ authored: [doc] }).map((item) => [item.key, item]),
    )
    for (const rule of SECTION_RULES) {
      expect(byKey.get(rule.key)?.result, rule.key).toBe('ok')
    }
  })
})
