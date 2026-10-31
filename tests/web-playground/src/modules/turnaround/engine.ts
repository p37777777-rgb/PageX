import { sopPlans } from './data'
import type {
  GroupId,
  RunEvent,
  RunGroupState,
  RunLogEntry,
  ServiceConfigItem,
  SopVersion,
} from './types'

/** 配餐调度依赖的供应商网关配置键 */
export const REQUIRED_VENDOR_KEY = 'CATERER_VENDOR'
/** 供应商网关的正确取值 */
export const REQUIRED_VENDOR_VALUE = 'gateway-catering-group:9120'
/** 致命错误的关键字样 */
export const VENDOR_FATAL_SNIPPET = 'fatal: CATERER_VENDOR not configured'
/** 配餐链路中断的步骤 */
export const FAILING_STEP_ID = 'load-meals'

/** 找到已保存配置中的供应商网关项（键名精确匹配、忽略首尾空白） */
export function findVendorConfig(configs: ServiceConfigItem[]): ServiceConfigItem | undefined {
  return configs.find((item) => item.key.trim() === REQUIRED_VENDOR_KEY)
}

/** 供应商网关配置是否已正确保存 */
export function hasVendorConfig(configs: ServiceConfigItem[]): boolean {
  const found = findVendorConfig(configs)
  return found !== undefined && found.value.trim() === REQUIRED_VENDOR_VALUE
}

/** 一轮执行结束后各分组的最终状态（供引擎与测试使用） */
export function resolveFinalGroupStates(configs: ServiceConfigItem[]): RunGroupState[] {
  const ok = hasVendorConfig(configs)
  return [
    { id: 'cabin', state: 'done', stepIndex: sopPlans.v3[0].steps.length },
    ok
      ? { id: 'catering', state: 'done', stepIndex: sopPlans.v3[1].steps.length }
      : { id: 'catering', state: 'failed', stepIndex: 1, failedStepId: FAILING_STEP_ID },
    ok
      ? { id: 'fuel', state: 'done', stepIndex: sopPlans.v3[2].steps.length }
      : { id: 'fuel', state: 'blocked', stepIndex: 0 },
  ]
}

/** 流水线是否 3 个分组全部完成 */
export function isRunComplete(runGroups: RunGroupState[]): boolean {
  const doneIds = new Set(runGroups.filter((g) => g.state === 'done').map((g) => g.id))
  return ['cabin', 'catering', 'fuel'].every((id) => doneIds.has(id as GroupId))
}

/** 把 HH:mm:ss 时钟推进 seconds 后返回新时钟 */
function advanceClock(clock: string, seconds: number): string {
  const [h, m, s] = clock.split(':').map((part) => Number.parseInt(part, 10))
  const total = (h * 3600 + m * 60 + s + seconds) % 86400
  const hh = String(Math.floor(total / 3600)).padStart(2, '0')
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

interface ScriptAccumulator {
  events: RunEvent[]
  seq: number
  clock: string
}

function pushLog(acc: ScriptAccumulator, groupId: GroupId, level: RunLogEntry['level'], step: string, message: string): RunLogEntry {
  acc.seq += 1
  return {
    seq: acc.seq,
    time: acc.clock,
    groupId,
    level,
    step,
    message,
  }
}

/**
 * 生成一轮完整执行的回放脚本（纯函数）：
 * 按分组顺序推进，缺供应商网关配置时在配餐装载步骤 fatal 并中止，
 * 后续分组不再产生事件（由调用方标记为 blocked）。
 */
export function buildRunScript(
  sopVersion: SopVersion,
  configs: ServiceConfigItem[],
  startClock: string,
): RunEvent[] {
  const plan = sopPlans[sopVersion]
  const vendorOk = hasVendorConfig(configs)
  const acc: ScriptAccumulator = { events: [], seq: 0, clock: startClock }

  for (const group of plan) {
    acc.clock = advanceClock(acc.clock, 4)
    acc.events.push({
      groupId: group.id,
      kind: 'group-start',
      stepId: '',
      state: 'running',
      log: pushLog(acc, group.id, 'info', group.name, `${group.name}分组进场（${group.crew}），开始过站作业`),
    })

    for (let i = 0; i < group.steps.length; i += 1) {
      const step = group.steps[i]
      acc.clock = advanceClock(acc.clock, 6)

      if (group.id === 'catering' && step.id === FAILING_STEP_ID && !vendorOk) {
        acc.events.push({
          groupId: group.id,
          kind: 'fatal',
          stepId: step.id,
          state: 'failed',
          log: pushLog(
            acc,
            group.id,
            'fatal',
            step.label,
            `${VENDOR_FATAL_SNIPPET} —— 配餐调度网关未注册供应商通道，装载指令无法下发，配餐链路中止`,
          ),
        })
        return acc.events
      }

      acc.events.push({
        groupId: group.id,
        kind: 'step',
        stepId: step.id,
        state: 'running',
        log: pushLog(acc, group.id, 'info', step.label, step.doneMessage),
      })
    }

    acc.events.push({
      groupId: group.id,
      kind: 'group-done',
      stepId: '',
      state: 'done',
      log: pushLog(acc, group.id, 'info', group.name, `${group.name}分组作业完成，退出机位作业面`),
    })
  }

  return acc.events
}

/** 依据回放事件推演某个分组在事件之后的步骤进度 */
export function stepIndexAfterEvent(groupId: GroupId, events: RunEvent[], uptoIndex: number): number {
  let done = 0
  for (let i = 0; i <= uptoIndex && i < events.length; i += 1) {
    const event = events[i]
    if (event.groupId !== groupId) continue
    if (event.kind === 'step') done += 1
    if (event.kind === 'fatal') break
  }
  return done
}
