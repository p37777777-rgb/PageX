import { shallowRef } from 'vue'
import type { PagexOracleApi, SceneOracle } from './types'

export const activeOracle = shallowRef<SceneOracle | null>(null)

const api: PagexOracleApi = {
  getSceneId: () => activeOracle.value?.sceneId ?? null,
  verify: () => activeOracle.value?.verify() ?? [],
  reset: () => {
    activeOracle.value?.reset()
  },
}

if (typeof window !== 'undefined') {
  window.__pagexOracle = api
}

export function registerOracle(oracle: SceneOracle) {
  activeOracle.value = oracle
}

export function unregisterOracle(oracle: SceneOracle) {
  if (activeOracle.value === oracle) {
    activeOracle.value = null
  }
}
