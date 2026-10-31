import { onBeforeUnmount, onMounted } from 'vue'
import { attachProbe, detachProbe } from './registry'
import type { InspectionItem, ModuleProbe } from './types'

/**
 * 模块内调用：挂载时注册体检探针，卸载时摘除。
 * runChecks 只读页面终态；resetModule 把模块数据恢复到初始状态。
 */
export function useModuleProbe(
  moduleId: string,
  handlers: {
    runChecks: () => InspectionItem[]
    resetModule: () => void
  },
) {
  const probe: ModuleProbe = {
    moduleId,
    runChecks: () => handlers.runChecks(),
    resetModule: () => handlers.resetModule(),
  }

  onMounted(() => attachProbe(probe))
  onBeforeUnmount(() => detachProbe(probe))
}
