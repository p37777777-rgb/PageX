import { flagMatches, missItem, okItem, pendingItem } from '../../probe'
import type { InspectionItem } from '../../probe'
import type { AuthoredManual, ManualsSnapshot } from './types'

/** 评审简报的标准标题（精确匹配，允许首尾空白） */
export const BRIEF_TITLE = 'A350 机队引进评审简报'

/** 正文最少有效字符数（去除空白与标签后） */
export const MIN_BODY_CHARS = 200

/** 最少标签数 */
export const MIN_LABEL_COUNT = 2

export interface SectionRule {
  key: string
  label: string
  keywords: string[]
}

/**
 * 正文启发式分组：每组命中任一关键词即视为覆盖。
 * 与验收步骤「正文需包含」六项一一对应。
 */
export const SECTION_RULES: SectionRule[] = [
  { key: 'sec-overview', label: '正文含概述段落', keywords: ['概述', '摘要', '综述', '总体情况', '背景'] },
  { key: 'sec-metrics', label: '正文含 Q3 核心运行指标', keywords: ['正常率', '架次', '行李差错', '投诉', 'NPS'] },
  { key: 'sec-revision', label: '正文含手册变更与废止时间', keywords: ['废止', '失效', '改装', '换版', '修订', 'OEB'] },
  { key: 'sec-risk', label: '正文含风险与决策要点', keywords: ['风险', '决策', '缓解', '应对'] },
  { key: 'sec-actions', label: '正文含行动项（负责人/截止）', keywords: ['行动项', '负责人', '截止', '待办'] },
  { key: 'sec-budget', label: '正文含 Q4 训练预算摘要', keywords: ['预算', '万元', '经费'] },
]

/** 找到标题恰为评审简报的已保存文档（忽略首尾空白） */
export function findBriefDoc(docs: AuthoredManual[]): AuthoredManual | undefined {
  return docs.find((doc) => doc.title.trim() === BRIEF_TITLE)
}

/** 提取正文可检索文本：纯文本 + 富文本去标签 */
export function extractSearchable(doc: AuthoredManual): string {
  const stripped = doc.richText
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  return `${doc.title}\n${doc.plainText}\n${stripped}`
}

/** 统计有效字符数（去除空白与标签） */
export function countEffectiveChars(doc: AuthoredManual): number {
  return extractSearchable(doc).replace(/\s/g, '').length
}

function sectionHit(text: string, rule: SectionRule): boolean {
  return rule.keywords.some((word) => text.includes(word))
}

/**
 * 只读判定：根据页面终态快照产出体检项。
 * 浏览类步骤无法由页面终态判定，以 pending 呈现。
 */
export function auditManuals(snapshot: ManualsSnapshot): InspectionItem[] {
  const docs = snapshot.authored
  const brief = findBriefDoc(docs)

  const items: InspectionItem[] = [
    pendingItem('browse-reading', '依次阅读手册库 6 篇指定文档', '阅读行为无法由页面终态判定'),
    pendingItem('collect-info', '收集引进批次/改装结论/指标/行动项/预算等关键信息', '信息收集无法由页面终态判定'),
    flagMatches(
      'brief-title',
      '已保存标题恰为「A350 机队引进评审简报」的文档',
      brief != null,
      BRIEF_TITLE,
      brief?.title ?? '未找到匹配文档',
    ),
    flagMatches(
      'brief-labels',
      `文档标签数 ≥ ${MIN_LABEL_COUNT}`,
      (brief?.labels.length ?? 0) >= MIN_LABEL_COUNT,
      `≥ ${MIN_LABEL_COUNT} 个`,
      brief ? `${brief.labels.length} 个` : '无文档',
    ),
  ]

  if (brief) {
    const text = extractSearchable(brief)
    const chars = countEffectiveChars(brief)
    items.push(
      flagMatches(
        'body-length',
        `正文有效字数 ≥ ${MIN_BODY_CHARS}`,
        chars >= MIN_BODY_CHARS,
        `≥ ${MIN_BODY_CHARS} 字`,
        `${chars} 字`,
      ),
    )
    for (const rule of SECTION_RULES) {
      const hit = sectionHit(text, rule)
      items.push(
        flagMatches(
          rule.key,
          rule.label,
          hit,
          '命中关键词',
          hit ? '已覆盖' : '未覆盖',
        ),
      )
    }
  } else {
    items.push(
      missItem('body-length', `正文有效字数 ≥ ${MIN_BODY_CHARS}`, `≥ ${MIN_BODY_CHARS} 字`, '无文档'),
    )
    for (const rule of SECTION_RULES) {
      items.push(missItem(rule.key, rule.label, '命中关键词', '无文档'))
    }
  }

  const stored = brief != null && docs.some((doc) => doc.id === brief.id)
  items.push(
    stored
      ? okItem('doc-saved', '文档已保存并出现在「我的文档」列表', brief.title)
      : missItem('doc-saved', '文档已保存并出现在「我的文档」列表', '列表中存在该文档', '未保存'),
  )

  return items
}
