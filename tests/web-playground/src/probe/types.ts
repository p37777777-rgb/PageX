/*
 * 模块体检（probe）契约：
 * 每个演练模块在挂载时注册一个 probe，通过 window.__aeroProbe
 * 暴露给外部脚本，用于只读式判定页面终态与恢复初始状态。
 */

export type InspectionResult = 'ok' | 'miss' | 'pending'

export interface InspectionItem {
  /** 稳定标识，供脚本比对 */
  key: string
  /** 面向人的检查项说明 */
  title: string
  result: InspectionResult
  /** 期望值（miss 时展示） */
  expect?: string
  /** 实际观测值 */
  got?: string
}

export interface ModuleProbe {
  moduleId: string
  runChecks: () => InspectionItem[]
  resetModule: () => void
}

export interface AeroProbeApi {
  moduleId: () => string | null
  runChecks: () => InspectionItem[]
  resetModule: () => void
}

declare global {
  interface Window {
    __aeroProbe?: AeroProbeApi
  }
}

export {}
