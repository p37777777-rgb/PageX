import type {
  GateWeightItem,
  ServiceConfigItem,
  SopGroupPlan,
  SopVersion,
  TurnaroundFlight,
} from './types'

/** 过站航班池：16 班，覆盖 A/B/C 三个停机坪区 */
export const initialFlights: TurnaroundFlight[] = [
  { id: 'fl-01', flightNo: 'CZ8821', stand: 'A-12', zone: 'A', registration: 'B-30K7', etd: '15:40', state: 'servicing', currentNode: '航前准备', nextAction: '按 SOP-v3 重推保障链' },
  { id: 'fl-02', flightNo: 'CZ8815', stand: 'A-05', zone: 'A', registration: 'B-20AE', etd: '14:55', state: 'ready', currentNode: '全部完成', nextAction: '催促登机' },
  { id: 'fl-03', flightNo: 'CZ3612', stand: 'A-08', zone: 'A', registration: 'B-32FP', etd: '16:20', state: 'servicing', currentNode: '客舱清洁', nextAction: '等待配餐进场' },
  { id: 'fl-04', flightNo: 'CZ6803', stand: 'A-15', zone: 'A', registration: 'B-11XD', etd: '17:05', state: 'arrived', currentNode: '轮挡与电源对接', nextAction: '下达保障指令' },
  { id: 'fl-05', flightNo: 'CZ4729', stand: 'A-03', zone: 'A', registration: 'B-27T9', etd: '18:30', state: 'hold', currentNode: '视情检查', nextAction: '等待机务放行' },
  { id: 'fl-06', flightNo: 'CZ9260', stand: 'A-19', zone: 'A', registration: 'B-30Q2', etd: '19:10', state: 'arrived', currentNode: '客梯车对接', nextAction: '下达保障指令' },
  { id: 'fl-07', flightNo: 'CZ3501', stand: 'B-21', zone: 'B', registration: 'B-335N', etd: '15:15', state: 'servicing', currentNode: '航空配餐', nextAction: '餐食装载复核' },
  { id: 'fl-08', flightNo: 'CZ2288', stand: 'B-26', zone: 'B', registration: 'B-14LP', etd: '16:45', state: 'servicing', currentNode: '加油勤务', nextAction: '油单签封' },
  { id: 'fl-09', flightNo: 'CZ5106', stand: 'B-30', zone: 'B', registration: 'B-22H8', etd: '17:35', state: 'arrived', currentNode: '轮挡与电源对接', nextAction: '下达保障指令' },
  { id: 'fl-10', flightNo: 'CZ7743', stand: 'B-24', zone: 'B', registration: 'B-19K4', etd: '18:50', state: 'ready', currentNode: '全部完成', nextAction: '组织旅客登机关舱门' },
  { id: 'fl-11', flightNo: 'CZ6118', stand: 'B-33', zone: 'B', registration: 'B-31D6', etd: '20:05', state: 'arrived', currentNode: '客梯车对接', nextAction: '下达保障指令' },
  { id: 'fl-12', flightNo: 'CZ3055', stand: 'C-41', zone: 'C', registration: 'B-23M1', etd: '15:25', state: 'servicing', currentNode: '客舱清洁', nextAction: '污水车清运' },
  { id: 'fl-13', flightNo: 'CZ4821', stand: 'C-45', zone: 'C', registration: 'B-16YS', etd: '16:55', state: 'servicing', currentNode: '航空配餐', nextAction: '冷藏餐车对接' },
  { id: 'fl-14', flightNo: 'CZ8134', stand: 'C-49', zone: 'C', registration: 'B-28G3', etd: '18:15', state: 'hold', currentNode: '除冰排队', nextAction: '关注除冰液存量' },
  { id: 'fl-15', flightNo: 'CZ1902', stand: 'C-52', zone: 'C', registration: 'B-20C6', etd: '19:40', state: 'arrived', currentNode: '轮挡与电源对接', nextAction: '下达保障指令' },
  { id: 'fl-16', flightNo: 'CZ7608', stand: 'C-56', zone: 'C', registration: 'B-33R5', etd: '21:00', state: 'departed', currentNode: '已推出', nextAction: '移交塔台' },
]

/** 保障 SOP：v2 为精简两步链，v3 为带复核的三步链；两组版本均在配餐装载处依赖供应商网关 */
export const sopPlans: Record<SopVersion, SopGroupPlan[]> = {
  v2: [
    {
      id: 'cabin',
      name: '客舱清洁',
      crew: '坪面保洁一班',
      steps: [
        { id: 'docking', label: '廊桥对接与桥载电源', doneMessage: '廊桥对接到位，桥载电源替代 APU 供电' },
        { id: 'cabin-clean', label: '客舱清扫与座椅复位', doneMessage: '客舱清扫完成，座椅内饰复位并移交乘务组' },
      ],
    },
    {
      id: 'catering',
      name: '航空配餐',
      crew: '航食调度中心',
      steps: [
        { id: 'pick-plan', label: '配餐单核对', doneMessage: '特殊餐与普通餐份数核对一致，装载单生效' },
        { id: 'load-meals', label: '餐食与饮品装载', doneMessage: '冷藏餐车装载完成，装机清单已回传配载' },
      ],
    },
    {
      id: 'fuel',
      name: '加油勤务',
      crew: '坪面油料二队',
      steps: [
        { id: 'hookup', label: '静电接地与管线对接', doneMessage: '静电接地确认，管线对接气密合格' },
        { id: 'signoff', label: '定量加注与油单签封', doneMessage: '按油单定量加注完成，双方签封油单' },
      ],
    },
  ],
  v3: [
    {
      id: 'cabin',
      name: '客舱清洁',
      crew: '坪面保洁一班',
      steps: [
        { id: 'docking', label: '廊桥对接与桥载电源', doneMessage: '廊桥对接到位，桥载电源替代 APU 供电' },
        { id: 'cabin-clean', label: '客舱清扫与座椅复位', doneMessage: '客舱清扫完成，座椅内饰复位并移交乘务组' },
        { id: 'deep-check', label: '内饰复检与异味处置', doneMessage: '内饰复检通过，异味处置记录已归档' },
      ],
    },
    {
      id: 'catering',
      name: '航空配餐',
      crew: '航食调度中心',
      steps: [
        { id: 'pick-plan', label: '配餐单核对', doneMessage: '特殊餐与普通餐份数核对一致，装载单生效' },
        { id: 'load-meals', label: '餐食与饮品装载', doneMessage: '冷藏餐车装载完成，装机清单已回传配载' },
        { id: 'seal-handover', label: '车封签与乘务交接', doneMessage: '餐车封签完成，与乘务组当面交接' },
      ],
    },
    {
      id: 'fuel',
      name: '加油勤务',
      crew: '坪面油料二队',
      steps: [
        { id: 'hookup', label: '静电接地与管线对接', doneMessage: '静电接地确认，管线对接气密合格' },
        { id: 'refuel', label: '定量加注与油样化验', doneMessage: '定量加注完成，油样化验目视合格' },
        { id: 'signoff', label: '油单签封与管路撤离', doneMessage: '双方签封油单，管路安全撤离机位' },
      ],
    },
  ],
}

/** 该航班（CZ8821）的保障服务配置基线：刻意缺少配餐供应商网关配置 */
export const initialSavedConfigs: ServiceConfigItem[] = [
  { key: 'STAND_POWER_MODE', value: 'gpu-400hz', remark: '桥载电源替代 APU 的供电模式' },
  { key: 'CABIN_CLEAN_CREW', value: 'terminal2-dayshift', remark: '客舱清洁作业班组' },
  { key: 'FUEL_ORDER_CHANNEL', value: 'va-interflow', remark: '加油单电子交互通道' },
  { key: 'BAGGAGE_BELT_PRIORITY', value: 'stand-first', remark: '行李转盘分配优先策略' },
  { key: 'PUSHBACK_TOW_WINDOW', value: '8', remark: '推出拖车召集提前量（分钟）' },
]

/** 登机口放行权重的已应用基线 */
export const initialGateWeights: GateWeightItem[] = [
  { gate: 'C08', share: 45 },
  { gate: 'C12', share: 30 },
  { gate: 'C18', share: 25 },
]

/** 流水线执行失败时 CZ8821 在总览中的呈现 */
export const failedFlightPatch = {
  state: 'hold' as const,
  currentNode: '航空配餐（中断）',
  nextAction: '排障后重推保障链',
}

/** 流水线执行成功时 CZ8821 在总览中的呈现 */
export const succeededFlightPatch = {
  state: 'ready' as const,
  currentNode: '保障链全部完成',
  nextAction: '旅客登机口放行',
}
