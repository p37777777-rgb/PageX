import { shallowRef } from 'vue'
import type { AeroProbeApi, ModuleProbe } from './types'

/** 当前挂载模块注册的体检探针 */
export const activeProbe = shallowRef<ModuleProbe | null>(null)

const api: AeroProbeApi = {
  moduleId: () => activeProbe.value?.moduleId ?? null,
  runChecks: () => activeProbe.value?.runChecks() ?? [],
  resetModule: () => {
    activeProbe.value?.resetModule()
  },
}

if (typeof window !== 'undefined') {
  window.__aeroProbe = api
}

export function attachProbe(probe: ModuleProbe) {
  activeProbe.value = probe
}

export function detachProbe(probe: ModuleProbe) {
  if (activeProbe.value === probe) {
    activeProbe.value = null
  }
}
