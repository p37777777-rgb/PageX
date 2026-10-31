/**
 * 特殊服务申请单的终态快照类型。
 * 页面表单与审计纯函数共用同一份结构，保证「所见即所判」。
 */
export interface ServiceRequestSnapshot {
  /** 旅客信息 */
  passengerName: string
  gender: string
  birthDate: string
  phone: string
  email: string
  idType: string
  idNumber: string
  /** 航班与行程 */
  flightNo: string
  flightDate: string
  departureAirport: string
  arrivalAirport: string
  boardingTime: string
  /** 服务需求 */
  serviceTypes: string[]
  meal: string
  companions: number
  remark: string
  /** 通知与确认 */
  smsNotify: boolean
  experienceRating: number
  serviceFee: number
  agreed: boolean
  /** 提交状态 */
  submitted: boolean
  receiptNo: string
}
