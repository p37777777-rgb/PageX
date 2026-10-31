import type { FlightRecord, RegionName, SlotName } from './types'

/** 航线区域全量取值（透视与字段下拉共用） */
export const REGION_VALUES: readonly RegionName[] = ['华东', '华南', '西南', '华北', '东北', '西北']

/** 出港时段全量取值 */
export const SLOT_VALUES: readonly SlotName[] = ['早高峰', '平峰', '晚高峰']

/**
 * 各区域的运行画像：西北航线受高原机场与备降冗余影响，延误率显著偏高，
 * 是本工作台下钻分析的目标维度。
 */
interface RegionProfile {
  region: RegionName
  loadBase: number
  delayBase: number
  complaintBase: number
}

const REGION_PROFILES: readonly RegionProfile[] = [
  { region: '华东', loadBase: 79, delayBase: 7.4, complaintBase: 0 },
  { region: '华南', loadBase: 77, delayBase: 9.6, complaintBase: 1 },
  { region: '华北', loadBase: 73, delayBase: 11.4, complaintBase: 2 },
  { region: '西南', loadBase: 75, delayBase: 12.8, complaintBase: 1 },
  { region: '东北', loadBase: 72, delayBase: 14.6, complaintBase: 2 },
  { region: '西北', loadBase: 70, delayBase: 22.3, complaintBase: 4 },
]

const round1 = (value: number): number => Math.round(value * 10) / 10

/**
 * 确定性构造 108 条航班执行明细（6 区域 × 3 时段 × 6 班），
 * 不依赖随机数，保证每次演练的数据与判定结论一致。
 */
function buildFlightRecords(): FlightRecord[] {
  const records: FlightRecord[] = []
  let seq = 0
  REGION_PROFILES.forEach((profile, regionIdx) => {
    SLOT_VALUES.forEach((slot, slotIdx) => {
      for (let n = 0; n < 6; n += 1) {
        seq += 1
        // 与序号绑定的确定性抖动（-2 ~ +2），模拟班次间波动
        const jitter = ((seq * 7 + regionIdx * 3) % 5) - 2
        const slotLoadBonus = slotIdx === 0 ? 5 : slotIdx === 1 ? 2 : 0
        records.push({
          flightNo: `LY${8200 + seq * 2}`,
          departureSlot: slot,
          region: profile.region,
          loadFactor: round1(profile.loadBase + slotLoadBonus + jitter * 0.8),
          delayRate: round1(profile.delayBase + jitter * 1.1 + (slotIdx === 2 ? 1.2 : 0)),
          complaints: Math.max(
            0,
            profile.complaintBase +
              ((seq + slotIdx) % 4 === 0 ? 1 : 0) -
              (jitter > 1 ? 1 : 0),
          ),
        })
      }
    })
  })
  return records
}

/** 全量航班执行明细（108 条） */
export const FLIGHT_RECORDS: readonly FlightRecord[] = buildFlightRecords()

/** 初始条件树：仅一个空的 AND 根组，等待被测 Agent 编排 */
export function createInitialTree() {
  return { kind: 'group' as const, id: 'otl-root', logic: 'AND' as const, children: [] }
}

export const INITIAL_TREE = createInitialTree()
