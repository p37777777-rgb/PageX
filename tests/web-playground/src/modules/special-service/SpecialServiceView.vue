<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { Bell, DocumentChecked, Position, Promotion, RefreshLeft, Service, User } from '@element-plus/icons-vue'
import { useModuleProbe } from '../../probe'
import { auditSnapshot, createEmptySnapshot, labelOf } from './audit'
import {
  AIRPORT_OPTIONS,
  GENDER_OPTIONS,
  ID_TYPE_OPTIONS,
  MEAL_OPTIONS,
  SERVICE_TYPE_OPTIONS,
} from './options'
import type { ServiceRequestSnapshot } from './types'

const form = reactive<ServiceRequestSnapshot>(createEmptySnapshot())
const formRef = ref<FormInstance>()
const submitting = ref(false)
const receiptTime = ref('')

type RuleCallback = (error?: string | Error) => void

function validateIdNumber(_rule: unknown, value: string, callback: RuleCallback) {
  const id = (value ?? '').trim()
  if (!form.idType) {
    callback(new Error('请先选择证件类型'))
    return
  }
  if (!id) {
    callback(new Error('请输入证件号码'))
    return
  }
  if (form.idType === 'id-card' && !/^\d{17}[\dXx]$/.test(id)) {
    callback(new Error('身份证号应为 18 位，末位可为 X'))
    return
  }
  if (form.idType !== 'id-card' && !/^[A-Za-z0-9]{5,18}$/.test(id)) {
    callback(new Error('证件号码应为 5–18 位字母或数字'))
    return
  }
  callback()
}

const rules: FormRules<ServiceRequestSnapshot> = {
  passengerName: [{ required: true, message: '请输入旅客姓名', trigger: 'blur' }],
  gender: [{ required: true, message: '请选择性别', trigger: 'change' }],
  birthDate: [{ required: true, message: '请选择出生日期', trigger: 'change' }],
  phone: [
    { required: true, message: '请输入联系手机', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '手机号应为 11 位且以 1 开头', trigger: 'blur' },
  ],
  email: [
    { required: true, message: '请输入联系邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
  ],
  idType: [{ required: true, message: '请选择证件类型', trigger: 'change' }],
  idNumber: [{ validator: validateIdNumber, trigger: 'blur' }],
  flightNo: [
    { required: true, message: '请输入航班号', trigger: 'blur' },
    { pattern: /^[A-Za-z0-9]{2}\d{3,4}$/, message: '航班号格式如 MU2317', trigger: 'blur' },
  ],
  flightDate: [{ required: true, message: '请选择航班日期', trigger: 'change' }],
  departureAirport: [{ required: true, message: '请选择出发机场', trigger: 'change' }],
  arrivalAirport: [{ required: true, message: '请选择到达机场', trigger: 'change' }],
  boardingTime: [{ required: true, message: '请选择登机时间', trigger: 'change' }],
  serviceTypes: [
    { required: true, type: 'array', min: 1, message: '至少选择一项服务类型', trigger: 'change' },
  ],
  meal: [{ required: true, message: '请选择特殊餐食', trigger: 'change' }],
  agreed: [
    {
      validator: (_rule: unknown, value: boolean, callback: RuleCallback) => {
        value ? callback() : callback(new Error('请勾选同意《特殊旅客服务告知书》'))
      },
      trigger: 'change',
    },
  ],
}

const serviceFeeMarks = { 0: '0', 100: '100', 200: '200', 300: '300', 400: '400', 500: '500' }

const summaryRows = computed(() => [
  { label: '旅客', value: form.passengerName || '—' },
  { label: '联系手机', value: form.phone || '—' },
  {
    label: '航班',
    value: form.flightNo ? `${form.flightDate || '—'} ${form.flightNo.toUpperCase()}` : '—',
  },
  {
    label: '行程',
    value: `${labelOf(AIRPORT_OPTIONS, form.departureAirport) || '—'} → ${
      labelOf(AIRPORT_OPTIONS, form.arrivalAirport) || '—'
    }`,
  },
  { label: '登机', value: form.boardingTime || '—' },
  {
    label: '服务',
    value: form.serviceTypes.length
      ? form.serviceTypes.map((v) => labelOf(SERVICE_TYPE_OPTIONS, v)).join('、')
      : '—',
  },
  { label: '餐食', value: labelOf(MEAL_OPTIONS, form.meal) || '—' },
  { label: '随行', value: `${form.companions} 人` },
  { label: '服务费', value: `不超过 ${form.serviceFee} 元` },
])

function resetForm() {
  Object.assign(form, createEmptySnapshot())
  receiptTime.value = ''
  formRef.value?.clearValidate()
}

async function handleSubmit() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().then(() => true).catch(() => false)
  if (!valid) {
    ElMessage.error('仍有字段未通过校验，请按提示补齐后再提交')
    return
  }
  submitting.value = true
  form.receiptNo = `SSA-${form.flightDate.replaceAll('-', '')}-${Math.floor(
    1000 + Math.random() * 9000,
  )}`
  form.submitted = true
  receiptTime.value = new Date().toLocaleString('zh-CN', { hour12: false })
  submitting.value = false
  ElMessage.success('特殊服务申请已提交，回执已生成')
}

useModuleProbe('special-service', {
  runChecks: () => auditSnapshot({ ...form }),
  resetModule: () => {
    Object.assign(form, createEmptySnapshot())
    receiptTime.value = ''
    formRef.value?.clearValidate()
  },
})
</script>

<template>
  <div class="sv-page">
    <header class="sv-head">
      <div>
        <h2>特殊服务申请</h2>
        <p>为特殊旅客提交地面与机上服务保障申请，站坪与客舱席位将按回执联动处置。</p>
      </div>
      <el-tag v-if="form.submitted" type="success" effect="light" size="large">
        回执 {{ form.receiptNo }}
      </el-tag>
    </header>

    <div class="sv-body">
      <el-form
        ref="formRef"
        class="sv-form"
        :model="form"
        :rules="rules"
        label-width="110px"
        label-position="right"
      >
        <el-alert
          class="sv-notice"
          type="info"
          :closable="false"
          show-icon
          title="特殊服务需在航班计划起飞前 48 小时申请，登机协助安排以出发机场当日资源为准。"
        />

        <section class="sv-card">
          <div class="sv-card-head">
            <el-icon><User /></el-icon>
            <h3>旅客信息</h3>
          </div>
          <div class="sv-grid">
            <el-form-item label="旅客姓名" prop="passengerName">
              <el-input v-model="form.passengerName" placeholder="与所持证件一致" maxlength="20" />
            </el-form-item>
            <el-form-item label="性别" prop="gender">
              <el-radio-group v-model="form.gender">
                <el-radio v-for="g in GENDER_OPTIONS" :key="g.value" :value="g.value">
                  {{ g.label }}
                </el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="出生日期" prop="birthDate">
              <el-date-picker
                v-model="form.birthDate"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="选择出生日期"
                style="width: 100%"
              />
            </el-form-item>
            <el-form-item label="联系手机" prop="phone">
              <el-input v-model="form.phone" placeholder="11 位手机号" maxlength="11" />
            </el-form-item>
            <el-form-item label="联系邮箱" prop="email">
              <el-input v-model="form.email" placeholder="name@example.com" />
            </el-form-item>
            <el-form-item label="证件类型" prop="idType">
              <el-select v-model="form.idType" placeholder="选择证件类型" style="width: 100%">
                <el-option
                  v-for="o in ID_TYPE_OPTIONS"
                  :key="o.value"
                  :label="o.label"
                  :value="o.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="证件号码" prop="idNumber" class="sv-span2">
              <el-input v-model="form.idNumber" placeholder="与所选证件类型对应" maxlength="18" />
            </el-form-item>
          </div>
        </section>

        <section class="sv-card">
          <div class="sv-card-head">
            <el-icon><Position /></el-icon>
            <h3>航班与行程</h3>
          </div>
          <div class="sv-grid">
            <el-form-item label="航班号" prop="flightNo">
              <el-input v-model="form.flightNo" placeholder="如 MU2317" maxlength="6" />
            </el-form-item>
            <el-form-item label="航班日期" prop="flightDate">
              <el-date-picker
                v-model="form.flightDate"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="选择航班日期"
                style="width: 100%"
              />
            </el-form-item>
            <el-form-item label="出发机场" prop="departureAirport">
              <el-select
                v-model="form.departureAirport"
                filterable
                placeholder="输入城市或机场检索"
                style="width: 100%"
              >
                <el-option
                  v-for="o in AIRPORT_OPTIONS"
                  :key="o.value"
                  :label="o.label"
                  :value="o.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="到达机场" prop="arrivalAirport">
              <el-select
                v-model="form.arrivalAirport"
                filterable
                placeholder="输入城市或机场检索"
                style="width: 100%"
              >
                <el-option
                  v-for="o in AIRPORT_OPTIONS"
                  :key="o.value"
                  :label="o.label"
                  :value="o.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="登机时间" prop="boardingTime">
              <el-time-picker
                v-model="form.boardingTime"
                value-format="HH:mm"
                format="HH:mm"
                placeholder="选择登机时间"
                style="width: 100%"
              />
            </el-form-item>
          </div>
        </section>

        <section class="sv-card">
          <div class="sv-card-head">
            <el-icon><Service /></el-icon>
            <h3>服务需求</h3>
          </div>
          <div class="sv-grid">
            <el-form-item label="服务类型" prop="serviceTypes" class="sv-span2">
              <el-checkbox-group v-model="form.serviceTypes" class="sv-check-group">
                <el-checkbox
                  v-for="o in SERVICE_TYPE_OPTIONS"
                  :key="o.value"
                  :value="o.value"
                  border
                >
                  {{ o.label }}
                </el-checkbox>
              </el-checkbox-group>
            </el-form-item>
            <el-form-item label="特殊餐食" prop="meal">
              <el-select v-model="form.meal" placeholder="选择餐食" style="width: 100%">
                <el-option
                  v-for="o in MEAL_OPTIONS"
                  :key="o.value"
                  :label="o.label"
                  :value="o.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="随行人数" prop="companions">
              <el-input-number v-model="form.companions" :min="0" :max="9" />
            </el-form-item>
            <el-form-item label="备注说明" prop="remark" class="sv-span2">
              <el-input
                v-model="form.remark"
                type="textarea"
                :rows="3"
                maxlength="200"
                show-word-limit
                placeholder="补充服务细节、忌口或过敏信息（选填）"
              />
            </el-form-item>
          </div>
        </section>

        <section class="sv-card">
          <div class="sv-card-head">
            <el-icon><Bell /></el-icon>
            <h3>通知与确认</h3>
          </div>
          <div class="sv-grid">
            <el-form-item label="短信通知" prop="smsNotify" class="sv-span2">
              <div class="sv-switch-line">
                <el-switch v-model="form.smsNotify" />
                <span>航班动态与服务保障节点变动时发送短信提醒</span>
              </div>
            </el-form-item>
            <el-form-item label="体验预期" prop="experienceRating" class="sv-span2">
              <el-rate v-model="form.experienceRating" />
            </el-form-item>
            <el-form-item label="可接受服务费" prop="serviceFee" class="sv-span2">
              <div class="sv-slider-line">
                <el-slider
                  v-model="form.serviceFee"
                  :min="0"
                  :max="500"
                  :step="10"
                  :marks="serviceFeeMarks"
                />
                <span class="sv-slider-value">{{ form.serviceFee }} 元</span>
              </div>
            </el-form-item>
            <el-form-item prop="agreed" class="sv-span2 sv-agree">
              <el-checkbox v-model="form.agreed">
                我已阅读并同意《特殊旅客服务告知书》，确认以上信息真实有效。
              </el-checkbox>
            </el-form-item>
          </div>
        </section>

        <div class="sv-actions">
          <el-button :icon="RefreshLeft" @click="resetForm">重置</el-button>
          <el-button type="primary" :icon="Promotion" :loading="submitting" @click="handleSubmit">
            提交申请
          </el-button>
        </div>
      </el-form>

      <aside class="sv-aside">
        <div class="sv-card sv-summary-card">
          <div class="sv-card-head">
            <el-icon><DocumentChecked /></el-icon>
            <h3>申请摘要</h3>
          </div>
          <template v-if="!form.submitted">
            <dl class="sv-summary">
              <div v-for="row in summaryRows" :key="row.label">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </div>
            </dl>
            <p class="sv-hint">提交后将生成受理回执，凭回执编号可在保障看板跟踪进度。</p>
          </template>
          <template v-else>
            <div class="sv-receipt">
              <el-tag type="success" effect="light">已受理</el-tag>
              <p class="sv-receipt-no">{{ form.receiptNo }}</p>
              <p class="sv-receipt-time">受理时间：{{ receiptTime }}</p>
            </div>
            <dl class="sv-summary">
              <div v-for="row in summaryRows" :key="row.label">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </div>
            </dl>
            <el-button class="sv-again" plain size="small" @click="resetForm">再填一单</el-button>
          </template>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.sv-page {
  max-width: 1180px;
  margin: 0 auto;
  padding: 20px 24px 32px;
}

.sv-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.sv-head h2 {
  margin: 0 0 4px;
  font-size: 20px;
  color: #0f172a;
}

.sv-head p {
  margin: 0;
  font-size: 13px;
  color: #64748b;
}

.sv-body {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.sv-form {
  flex: 1;
  min-width: 0;
}

.sv-notice {
  margin-bottom: 16px;
  border-radius: 8px;
}

.sv-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 18px 20px 6px;
  margin-bottom: 16px;
}

.sv-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  padding-bottom: 10px;
  border-bottom: 1px dashed #e2e8f0;
}

.sv-card-head .el-icon {
  color: #0e7490;
  font-size: 17px;
}

.sv-card-head h3 {
  margin: 0;
  font-size: 15px;
  color: #0f172a;
}

.sv-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 24px;
}

.sv-span2 {
  grid-column: span 2;
}

.sv-check-group {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.sv-check-group :deep(.el-checkbox) {
  margin-right: 0;
}

.sv-switch-line {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #64748b;
  font-size: 13px;
}

.sv-slider-line {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding-right: 8px;
}

.sv-slider-line .el-slider {
  flex: 1;
}

.sv-slider-value {
  flex-shrink: 0;
  min-width: 52px;
  text-align: right;
  font-size: 13px;
  color: #0e7490;
  font-weight: 600;
}

.sv-agree {
  padding-top: 4px;
}

.sv-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-bottom: 16px;
}

.sv-aside {
  width: 300px;
  flex-shrink: 0;
  position: sticky;
  top: 16px;
}

.sv-summary-card {
  padding: 18px 20px 20px;
  margin-bottom: 0;
}

.sv-summary {
  margin: 0;
}

.sv-summary div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px dashed #eef2f6;
  font-size: 13px;
}

.sv-summary dt {
  flex-shrink: 0;
  color: #64748b;
}

.sv-summary dd {
  margin: 0;
  color: #0f172a;
  text-align: right;
  word-break: break-all;
}

.sv-hint {
  margin: 12px 0 0;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.6;
}

.sv-receipt {
  padding: 12px 14px;
  margin-bottom: 8px;
  border: 1px solid #b7d6df;
  border-radius: 8px;
  background: #f3fafc;
}

.sv-receipt-no {
  margin: 8px 0 4px;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #0e7490;
}

.sv-receipt-time {
  margin: 0;
  font-size: 12px;
  color: #64748b;
}

.sv-again {
  margin-top: 12px;
}
</style>
