/** 下拉 / 多选候选项 */
export interface SelectOption {
  value: string
  label: string
}

/** 证件类型 */
export const ID_TYPE_OPTIONS: SelectOption[] = [
  { value: 'id-card', label: '居民身份证' },
  { value: 'passport', label: '护照' },
  { value: 'hk-mo-permit', label: '港澳居民来往内地通行证' },
  { value: 'tw-permit', label: '台湾居民来往大陆通行证' },
  { value: 'foreign-residence', label: '外国人永久居留身份证' },
]

/** 性别 */
export const GENDER_OPTIONS: SelectOption[] = [
  { value: 'female', label: '女' },
  { value: 'male', label: '男' },
]

/** 本场通航机场（可搜索下拉） */
export const AIRPORT_OPTIONS: SelectOption[] = [
  { value: 'SHA', label: '上海虹桥国际机场 T2（SHA）' },
  { value: 'PVG', label: '上海浦东国际机场 T1（PVG）' },
  { value: 'PKX', label: '北京大兴国际机场（PKX）' },
  { value: 'PEK', label: '北京首都国际机场 T3（PEK）' },
  { value: 'SZX', label: '深圳宝安国际机场 T3（SZX）' },
  { value: 'CAN', label: '广州白云国际机场 T2（CAN）' },
  { value: 'TFU', label: '成都天府国际机场 T2（TFU）' },
  { value: 'HGH', label: '杭州萧山国际机场 T4（HGH）' },
  { value: 'KMG', label: '昆明长水国际机场（KMG）' },
  { value: 'XIY', label: '西安咸阳国际机场 T5（XIY）' },
]

/** 特殊服务类型（多选） */
export const SERVICE_TYPE_OPTIONS: SelectOption[] = [
  { value: 'wheelchair', label: '轮椅协助' },
  { value: 'child-alone', label: '无人陪伴儿童' },
  { value: 'medical-oxygen', label: '机上医疗氧' },
  { value: 'guide-dog', label: '导盲犬' },
]

/** 特殊餐食 */
export const MEAL_OPTIONS: SelectOption[] = [
  { value: 'normal', label: '正常餐' },
  { value: 'low-sugar', label: '低糖餐' },
  { value: 'low-sodium', label: '低钠餐' },
  { value: 'child', label: '儿童餐' },
  { value: 'vegetarian', label: '素食' },
]
