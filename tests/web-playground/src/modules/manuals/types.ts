/** 手册中心 · 领域类型定义 */

export type CategoryKey =
  | 'fleet'
  | 'engineering'
  | 'training'
  | 'ops-data'
  | 'meeting'
  | 'finance'

export interface CategoryMeta {
  key: CategoryKey
  label: string
  intro: string
}

export type ManualBlock =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; headers: string[]; rows: string[][]; note?: string }
  | { kind: 'quote'; text: string; source?: string }

export interface LibraryArticle {
  slug: string
  title: string
  category: CategoryKey
  author: string
  department: string
  publishedOn: string
  readMinutes: number
  tags: string[]
  digest: string
  blocks: ManualBlock[]
}

/** 编写台保存后的用户文档 */
export interface AuthoredManual {
  id: string
  title: string
  labels: string[]
  richText: string
  plainText: string
  charTotal: number
  savedAt: number
  revisedAt: number
}

/** 判定所需的页面终态快照 */
export interface ManualsSnapshot {
  authored: AuthoredManual[]
}
