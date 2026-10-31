import { describe, expect, it } from 'vitest'
import { initialGateWeights, initialSavedConfigs, sopPlans } from './data'
import {
  FAILING_STEP_ID,
  REQUIRED_VENDOR_KEY,
  REQUIRED_VENDOR_VALUE,
  VENDOR_FATAL_SNIPPET,
  buildRunScript,
  hasVendorConfig,
  isRunComplete,
  resolveFinalGroupStates,
  stepIndexAfterEvent,
} from './engine'
import {
  GATE_CHECK_KEY,
  PIPELINE_CHECK_KEY,
  VENDOR_CHECK_KEY,
  auditTurnaround,
} from './audit'
import type { GateWeightItem, RunGroupState, ServiceConfigItem, TurnaroundSnapshot } from './types'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function vendorConfig(): ServiceConfigItem {
  return { key: REQUIRED_VENDOR_KEY, value: REQUIRED_VENDOR_VALUE, remark: '配餐调度网关' }
}

function allDoneGroups(): RunGroupState[] {
  return [
    { id: 'cabin', state: 'done', stepIndex: 3 },
    { id: 'catering', state: 'done', stepIndex: 3 },
    { id: 'fuel', state: 'done', stepIndex: 3 },
  ]
}

function failedGroups(): RunGroupState[] {
  return [
    { id: 'cabin', state: 'done', stepIndex: 3 },
    { id: 'catering', state: 'failed', stepIndex: 1, failedStepId: FAILING_STEP_ID },
    { id: 'fuel', state: 'blocked', stepIndex: 0 },
  ]
}

function snapshot(overrides: Partial<TurnaroundSnapshot> = {}): TurnaroundSnapshot {
  return {
    savedConfigs: clone(initialSavedConfigs),
    runGroups: [],
    appliedGateWeights: clone(initialGateWeights),
    ...overrides,
  }
}

describe('engine', () => {
  it('detects a correctly saved vendor config', () => {
    expect(hasVendorConfig(initialSavedConfigs)).toBe(false)
    expect(hasVendorConfig([...clone(initialSavedConfigs), vendorConfig()])).toBe(true)
    expect(hasVendorConfig([{ key: REQUIRED_VENDOR_KEY, value: '  gateway-catering-group:9120 ', remark: '' }])).toBe(true)
  })

  it('rejects a vendor config with the wrong value', () => {
    expect(hasVendorConfig([{ key: REQUIRED_VENDOR_KEY, value: 'gateway-catering-group:9100', remark: '' }])).toBe(false)
  })

  it('locates the fatal step when the vendor config is missing', () => {
    const states = resolveFinalGroupStates(clone(initialSavedConfigs))
    expect(states.find((group) => group.id === 'catering')?.state).toBe('failed')
    expect(states.find((group) => group.id === 'fuel')?.state).toBe('blocked')
  })

  it('script halts with the fatal log when the vendor config is missing', () => {
    const events = buildRunScript('v3', clone(initialSavedConfigs), '14:32:05')
    const fatal = events.find((event) => event.kind === 'fatal')
    expect(fatal).toBeDefined()
    expect(fatal?.stepId).toBe(FAILING_STEP_ID)
    expect(fatal?.log.message).toContain(VENDOR_FATAL_SNIPPET)
    expect(events.some((event) => event.groupId === 'fuel' && event.kind === 'group-done')).toBe(false)
  })

  it('script completes all groups once the vendor config exists', () => {
    const events = buildRunScript('v3', [...clone(initialSavedConfigs), vendorConfig()], '14:32:05')
    expect(events.some((event) => event.kind === 'fatal')).toBe(false)
    for (const plan of sopPlans.v3) {
      expect(events.some((event) => event.groupId === plan.id && event.kind === 'group-done')).toBe(true)
    }
  })

  it('counts progressed steps per group', () => {
    const events = buildRunScript('v2', [...clone(initialSavedConfigs), vendorConfig()], '14:32:05')
    expect(stepIndexAfterEvent('cabin', events, 2)).toBe(2)
    expect(stepIndexAfterEvent('fuel', events, events.length - 1)).toBe(sopPlans.v2[2].steps.length)
  })
})

describe('auditTurnaround', () => {
  it('misses everything on the untouched page', () => {
    const items = auditTurnaround(snapshot())
    expect(items.find((item) => item.key === VENDOR_CHECK_KEY)?.result).toBe('miss')
    expect(items.find((item) => item.key === PIPELINE_CHECK_KEY)?.result).toBe('miss')
    expect(items.find((item) => item.key === GATE_CHECK_KEY)?.result).toBe('miss')
  })

  it('passes only the vendor item after saving the config but not rerunning', () => {
    const items = auditTurnaround(
      snapshot({ savedConfigs: [...clone(initialSavedConfigs), vendorConfig()] }),
    )
    expect(items.find((item) => item.key === VENDOR_CHECK_KEY)?.result).toBe('ok')
    expect(items.find((item) => item.key === PIPELINE_CHECK_KEY)?.result).toBe('miss')
  })

  it('misses the vendor item on a wrong value even when the pipeline is green', () => {
    const items = auditTurnaround(
      snapshot({
        savedConfigs: [{ key: REQUIRED_VENDOR_KEY, value: 'gateway-catering-group:9100', remark: '' }],
        runGroups: allDoneGroups(),
      }),
    )
    expect(items.find((item) => item.key === VENDOR_CHECK_KEY)?.result).toBe('miss')
    expect(items.find((item) => item.key === PIPELINE_CHECK_KEY)?.result).toBe('ok')
  })

  it('misses the pipeline item on a failed catering run', () => {
    const items = auditTurnaround(
      snapshot({
        savedConfigs: [...clone(initialSavedConfigs), vendorConfig()],
        runGroups: failedGroups(),
      }),
    )
    expect(items.find((item) => item.key === PIPELINE_CHECK_KEY)?.result).toBe('miss')
  })

  it('misses the gate item unless the applied C12 share is 100', () => {
    const weights = (share: number): GateWeightItem[] => [
      { gate: 'C08', share: 0 },
      { gate: 'C12', share },
      { gate: 'C18', share: 0 },
    ]
    const base = {
      savedConfigs: [...clone(initialSavedConfigs), vendorConfig()],
      runGroups: allDoneGroups(),
    }
    expect(auditTurnaround(snapshot({ ...base, appliedGateWeights: weights(90) })).find((item) => item.key === GATE_CHECK_KEY)?.result).toBe('miss')
    expect(auditTurnaround(snapshot({ ...base, appliedGateWeights: [] })).find((item) => item.key === GATE_CHECK_KEY)?.result).toBe('miss')
  })

  it('passes all items on the fully fixed terminal state', () => {
    const items = auditTurnaround(
      snapshot({
        savedConfigs: [...clone(initialSavedConfigs), vendorConfig()],
        runGroups: allDoneGroups(),
        appliedGateWeights: [
          { gate: 'C08', share: 0 },
          { gate: 'C12', share: 100 },
          { gate: 'C18', share: 0 },
        ],
      }),
    )
    expect(items.every((item) => item.result === 'ok')).toBe(true)
  })
})

describe('isRunComplete', () => {
  it('requires all three groups to be done', () => {
    expect(isRunComplete(failedGroups())).toBe(false)
    expect(isRunComplete(allDoneGroups())).toBe(true)
    expect(isRunComplete([])).toBe(false)
  })
})
