<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Check,
  Close,
  DocumentChecked,
  Paperclip,
  Search,
  Suitcase,
  Van,
} from '@element-plus/icons-vue'
import { useModuleProbe } from '../../probe'
import { auditBaggageClaims } from './audit'
import {
  appealAttachmentText,
  claimQueue,
  claimRules,
  DELIVERY_DATE,
  DEPRECIATION_PAYOUT,
  dialogueThread,
  journeyNodes,
} from './data'
import { createInitialState, toSnapshot } from './state'
import type { AwardPlan } from './types'

const state = reactive(createInitialState())

/* ---------- 左侧理赔待办队列 ---------- */
const keyword = ref('')

const filteredQueue = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return claimQueue
  return claimQueue.filter(
    (item) => item.id.toLowerCase().includes(text) || item.passenger.includes(keyword.value.trim()),
  )
})

const activeCase = computed(
  () => claimQueue.find((item) => item.id === state.selectedId) ?? claimQueue[0],
)

function yuan(amount: number): string {
  return `¥${amount.toFixed(2)}`
}

/* ---------- 详情区页签 ---------- */
const TAB_DEFS: Array<{ name: 'thread' | 'journey' | 'verdict'; label: string }> = [
  { name: 'thread', label: '旅客沟通记录' },
  { name: 'journey', label: '行李运输轨迹' },
  { name: 'verdict', label: '平台裁决' },
]

/* ---------- 裁决表单 ---------- */
const PLAN_OPTIONS: Array<{ value: AwardPlan; label: string }> = [
  { value: 'full', label: '全额赔付' },
  { value: 'depreciation', label: '折旧赔付' },
  { value: 'reject', label: '拒绝赔付' },
]

function toggleAttachment() {
  state.attachmentExpanded = !state.attachmentExpanded
}

function submitVerdict() {
  if (state.overlayVisible) {
    ElMessage.warning('当前有弹窗未关闭，请先处理屏幕上的弹窗')
    return
  }
  if (!state.plan) {
    ElMessage.error('请先选择赔付方案')
    return
  }
  if (!state.basis.trim()) {
    ElMessage.error('请填写核验依据后再提交')
    return
  }
  state.submitted = true
  state.receiptNo = `ADJ-${state.selectedId.slice(-3)}-${String(Date.now()).slice(-6)}`
  ElMessage.success('裁决已提交并归档，回执已发送至旅客预留联系方式')
}

/* ---------- 凌越会员权益调研遮罩（进入详情后约 1.2s 弹出） ---------- */
let overlayTimer: number | undefined

function armOverlay() {
  state.overlayVisible = false
  if (overlayTimer) window.clearTimeout(overlayTimer)
  overlayTimer = window.setTimeout(() => {
    state.overlayVisible = true
  }, 1200)
}

onMounted(() => {
  armOverlay()
})

onBeforeUnmount(() => {
  if (overlayTimer) window.clearTimeout(overlayTimer)
})

function dismissOverlay() {
  state.overlayVisible = false
  ElMessage.info('已关闭会员权益调研弹窗')
}

/* ---------- 体检探针 ---------- */
useModuleProbe('baggage-claims', {
  runChecks: () => auditBaggageClaims(toSnapshot(state)),
  resetModule: () => {
    Object.assign(state, createInitialState())
    keyword.value = ''
    armOverlay()
  },
})
</script>

<template>
  <div class="claims-console">
    <div class="console-body">
      <!-- 左侧：理赔待办队列 -->
      <aside class="queue-pane">
        <div class="queue-head">
          <div class="queue-caption">
            <span class="queue-title">理赔待办</span>
            <span class="queue-count">{{ filteredQueue.length }}</span>
          </div>
          <el-input
            v-model="keyword"
            placeholder="搜索工单号 / 旅客"
            :prefix-icon="Search"
            size="small"
            clearable
          />
        </div>
        <div class="queue-scroll">
          <button
            v-for="item in filteredQueue"
            :key="item.id"
            type="button"
            class="case-card"
            :class="{ picked: item.id === state.selectedId, hot: item.urgent }"
            @click="state.selectedId = item.id"
          >
            <span class="case-top">
              <span class="case-no">{{ item.id }}</span>
              <span class="case-money">{{ yuan(item.claimAmount) }}</span>
            </span>
            <span class="case-mid">
              <span class="case-passenger">{{ item.passenger }}</span>
              <span class="case-type">{{ item.luggageType }}</span>
            </span>
            <span class="case-bottom">
              <span class="case-time">提交于 {{ item.submittedAt }}</span>
              <span v-if="item.urgent" class="case-flag">加急</span>
            </span>
          </button>
          <div v-if="filteredQueue.length === 0" class="queue-blank">没有匹配的待办工单</div>
        </div>
      </aside>

      <!-- 右侧：工单详情 -->
      <main class="detail-pane">
        <header class="case-strip">
          <div class="strip-id">
            <span class="strip-no">{{ activeCase.id }}</span>
            <span class="strip-badge">{{ activeCase.urgent ? '加急' : '常规' }}</span>
            <span class="strip-status">{{ state.submitted ? '已裁决' : '待裁决' }}</span>
          </div>
          <div class="strip-info">
            <span>旅客 {{ activeCase.passenger }}</span>
            <span>{{ activeCase.flightNo }}（{{ activeCase.route }}）</span>
            <span>{{ activeCase.luggageType }}</span>
            <span class="strip-claim">索赔 {{ yuan(activeCase.claimAmount) }}</span>
          </div>
        </header>

        <div class="detail-workbench">
          <el-tabs v-model="state.activeTab">
            <el-tab-pane
              v-for="tab in TAB_DEFS"
              :key="tab.name"
              :label="tab.label"
              :name="tab.name"
            />
          </el-tabs>

          <!-- 页签一：旅客沟通记录 -->
          <section v-show="state.activeTab === 'thread'" class="pane pane-thread">
            <div class="thread-flow">
              <template v-for="msg in dialogueThread" :key="msg.id">
                <article class="talk" :class="msg.role === '旅客' ? 'by-passenger' : 'by-agent'">
                  <div class="talk-head">
                    <b>{{ msg.speaker }}</b>
                    <span>{{ msg.time }}</span>
                  </div>
                  <div class="talk-body">{{ msg.content }}</div>
                  <div v-if="msg.attachment" class="talk-file">
                    <div class="file-bar">
                      <span class="file-name">
                        <el-icon :size="14"><Paperclip /></el-icon>
                        申诉材料附件：{{ msg.attachment }}
                      </span>
                      <el-button size="small" link type="primary" @click="toggleAttachment">
                        {{ state.attachmentExpanded ? '收起附件正文' : '展开附件正文' }}
                      </el-button>
                    </div>
                    <pre v-if="state.attachmentExpanded" class="file-content">{{ appealAttachmentText }}</pre>
                  </div>
                </article>
              </template>
            </div>
          </section>

          <!-- 页签二：行李运输轨迹 -->
          <section v-show="state.activeTab === 'journey'" class="pane pane-journey">
            <div class="rule-card">
              <div class="rule-title">
                <el-icon :size="14"><DocumentChecked /></el-icon>
                平台理赔规则
              </div>
              <ol class="rule-list">
                <li v-for="(rule, idx) in claimRules" :key="idx">{{ rule }}</li>
              </ol>
            </div>
            <div class="journey-card">
              <div class="journey-caption">
                <el-icon :size="14"><Van /></el-icon>
                全程运输轨迹（{{ journeyNodes.length }} 节点）· 交付时间 {{ DELIVERY_DATE }}
              </div>
              <el-timeline class="journey-line">
                <el-timeline-item
                  v-for="(node, idx) in journeyNodes"
                  :key="idx"
                  :timestamp="node.time"
                  :type="node.highlight ? 'primary' : 'info'"
                  :hollow="!node.highlight"
                  :size="node.highlight ? 'large' : 'normal'"
                >
                  <div class="node" :class="{ delivered: node.highlight }">
                    <div class="node-stage">{{ node.stage }}</div>
                    <div class="node-note">{{ node.note }}</div>
                  </div>
                </el-timeline-item>
              </el-timeline>
            </div>
          </section>

          <!-- 页签三：平台裁决 -->
          <section v-show="state.activeTab === 'verdict'" class="pane pane-verdict">
            <el-form label-position="top" class="verdict-form">
              <el-form-item label="赔付方案">
                <el-radio-group v-model="state.plan">
                  <el-radio-button
                    v-for="opt in PLAN_OPTIONS"
                    :key="opt.value"
                    :value="opt.value"
                  >
                    {{ opt.label }}
                  </el-radio-button>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="赔付金额（元）">
                <el-input-number
                  v-model="state.amount"
                  :min="0"
                  :max="99999"
                  :precision="2"
                  :step="100"
                  placeholder="0.00"
                />
                <span class="amount-hint">理赔规则建议折旧赔付 {{ DEPRECIATION_PAYOUT.toFixed(2) }} 元</span>
              </el-form-item>
              <el-form-item label="核验依据">
                <el-input
                  v-model="state.basis"
                  type="textarea"
                  :rows="4"
                  :placeholder="`请说明行李交付时间（${DELIVERY_DATE}）核验结论、适用理赔规则条款与折旧测算口径`"
                />
              </el-form-item>
              <div class="verdict-actions">
                <el-button type="primary" :icon="Check" @click="submitVerdict">提交裁决</el-button>
              </div>
            </el-form>
            <div v-if="state.submitted" class="verdict-receipt">
              <el-icon :size="15"><Suitcase /></el-icon>
              裁决已归档，回执编号 {{ state.receiptNo }}，旅客将收到赔付短信通知。
            </div>
          </section>
        </div>
      </main>
    </div>

    <!-- 凌越会员权益调研遮罩：不关闭无法操作页面 -->
    <div v-if="state.overlayVisible" class="survey-shade">
      <div class="survey-card">
        <button type="button" class="survey-exit" aria-label="关闭调研" @click="dismissOverlay">
          <el-icon :size="14"><Close /></el-icon>
        </button>
        <p class="survey-kicker">凌越航空 · 常旅客运营中心</p>
        <h3>凌越会员权益调研</h3>
        <p class="survey-desc">
          为优化天合臻享会员的行李保障权益，诚邀您花 1 分钟参与本次调研。
          提交后可领取 500 凌越里程，活动截至本周日。
        </p>
        <div class="survey-question">
          <div class="q-title">1. 您最希望优先升级哪项行李权益？</div>
          <el-radio-group>
            <el-radio value="a">破损先行赔付</el-radio>
            <el-radio value="b">延误免额用卡</el-radio>
            <el-radio value="c">行李额度加赠</el-radio>
          </el-radio-group>
        </div>
        <el-button class="survey-go" type="primary" @click="dismissOverlay">提交并领取里程</el-button>
        <button type="button" class="survey-skip" @click="dismissOverlay">暂不参与，返回工作台</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.claims-console {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: #f2f6f8;
}

.console-body {
  display: grid;
  grid-template-columns: 312px minmax(0, 1fr);
  height: 100%;
}

/* ---------- 左侧队列 ---------- */
.queue-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fff;
  border-right: 1px solid #dde7ec;
}

.queue-head {
  padding: 12px 14px;
  border-bottom: 1px solid #e8eff2;
}

.queue-caption {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.queue-title {
  font-size: 14px;
  font-weight: 700;
  color: #17323d;
}

.queue-count {
  padding: 0 8px;
  border-radius: 9px;
  background: #0e7490;
  color: #fff;
  font-size: 11px;
  line-height: 18px;
}

.queue-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px;
}

.case-card {
  display: block;
  width: 100%;
  margin-bottom: 8px;
  padding: 9px 11px;
  border: 1px solid #e3ecf0;
  border-radius: 8px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.case-card:hover {
  border-color: #7fbfcf;
}

.case-card.picked {
  border-color: #0e7490;
  box-shadow: inset 3px 0 0 #0e7490, 0 1px 4px rgba(14, 116, 144, 0.14);
  background: #f4fafc;
}

.case-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.case-no {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: #6b8794;
}

.case-money {
  font-size: 12px;
  font-weight: 600;
  color: #17323d;
}

.case-mid {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-top: 3px;
}

.case-passenger {
  font-size: 13px;
  font-weight: 600;
  color: #223;
}

.case-type {
  font-size: 11px;
  color: #7d95a1;
}

.case-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 3px;
}

.case-time {
  font-size: 11px;
  color: #93a8b2;
}

.case-flag {
  padding: 0 6px;
  border-radius: 3px;
  background: #fdf0e6;
  color: #b25e12;
  font-size: 10px;
  line-height: 17px;
}

.queue-blank {
  padding: 24px 0;
  text-align: center;
  font-size: 12px;
  color: #93a8b2;
}

/* ---------- 右侧详情 ---------- */
.detail-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.case-strip {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 18px;
  background: #fff;
  border-bottom: 1px solid #e8eff2;
}

.strip-id {
  display: flex;
  align-items: center;
  gap: 10px;
}

.strip-no {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 15px;
  font-weight: 700;
  color: #17323d;
}

.strip-badge,
.strip-status {
  padding: 0 8px;
  border-radius: 3px;
  font-size: 11px;
  line-height: 18px;
}

.strip-badge {
  background: #fdf0e6;
  color: #b25e12;
}

.strip-status {
  background: #e6f3f6;
  color: #0e7490;
}

.strip-info {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  font-size: 12px;
  color: #5f7a86;
}

.strip-claim {
  font-weight: 600;
  color: #b25e12;
}

.detail-workbench {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0 18px;
  background: #fff;
}

.detail-workbench :deep(.el-tabs__header) {
  margin-bottom: 0;
}

.pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 2px 20px;
}

/* 页签一：沟通记录 */
.thread-flow {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 760px;
}

.talk.by-passenger {
  align-self: flex-start;
}

.talk.by-agent {
  align-self: flex-end;
}

.talk-head {
  display: flex;
  gap: 10px;
  margin-bottom: 4px;
  font-size: 11px;
  color: #93a8b2;
}

.talk-head b {
  color: #4a6672;
}

.talk-body {
  max-width: 560px;
  padding: 10px 13px;
  border-radius: 3px 12px 12px 12px;
  background: #eef4f6;
  font-size: 13px;
  line-height: 1.7;
  color: #2c3e46;
  white-space: pre-wrap;
}

.by-agent .talk-body {
  border-radius: 12px 3px 12px 12px;
  background: #e9f5f7;
  border: 1px solid #d3e9ee;
}

.talk-file {
  margin-top: 8px;
  width: min(560px, 100%);
  border: 1px solid #d3e4ea;
  border-radius: 6px;
  background: #fbfdfe;
}

.file-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
}

.file-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #4a6672;
  word-break: break-all;
}

.file-content {
  margin: 0;
  padding: 12px 14px;
  border-top: 1px solid #e3eef2;
  background: #f4f8fa;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.7;
  color: #3d5560;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 页签二：轨迹 */
.pane-journey {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.rule-card {
  width: 320px;
  flex-shrink: 0;
  padding: 12px 14px;
  border: 1px solid #efe3c8;
  border-radius: 8px;
  background: #fdf9ee;
}

.rule-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 700;
  color: #8a6a1f;
}

.rule-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  line-height: 1.7;
  color: #6d5a2c;
}

.journey-card {
  flex: 1;
  min-width: 380px;
  padding: 12px 16px;
  border: 1px solid #e3ecf0;
  border-radius: 8px;
  background: #fbfdfe;
}

.journey-caption {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 14px;
  font-size: 13px;
  font-weight: 700;
  color: #17323d;
}

.journey-line {
  padding-left: 4px;
}

.node-stage {
  font-size: 13px;
  font-weight: 600;
  color: #2c3e46;
}

.node-note {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.6;
  color: #7d95a1;
}

.node.delivered .node-stage {
  color: #0e7490;
}

/* 页签三：裁决 */
.pane-verdict {
  max-width: 640px;
}

.amount-hint {
  margin-left: 12px;
  font-size: 12px;
  color: #8a6a1f;
}

.verdict-actions {
  margin-top: 6px;
}

.verdict-receipt {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 10px 12px;
  border: 1px solid #bfe0e8;
  border-radius: 6px;
  background: #ecf6f8;
  font-size: 13px;
  color: #0e7490;
}

/* ---------- 会员权益调研遮罩 ---------- */
.survey-shade {
  position: absolute;
  inset: 0;
  z-index: 2600;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(9, 34, 44, 0.52);
}

.survey-card {
  position: relative;
  width: 430px;
  padding: 22px 22px 18px;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 14px 40px rgba(9, 34, 44, 0.3);
}

.survey-exit {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 50%;
  background: #eef4f6;
  color: #6b8794;
  cursor: pointer;
}

.survey-exit:hover {
  background: #dcebf0;
  color: #17323d;
}

.survey-kicker {
  margin: 0;
  font-size: 12px;
  color: #93a8b2;
}

.survey-card h3 {
  margin: 6px 0 8px;
  font-size: 17px;
  color: #17323d;
}

.survey-desc {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.7;
  color: #5f7a86;
}

.survey-question {
  margin-bottom: 16px;
  padding: 12px 14px;
  border-radius: 8px;
  background: #f4f8fa;
}

.q-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #2c3e46;
}

.survey-go {
  width: 100%;
  margin: 0 0 6px;
}

.survey-skip {
  display: block;
  width: 100%;
  padding: 6px 0;
  border: 0;
  background: transparent;
  font-size: 12px;
  color: #93a8b2;
  cursor: pointer;
}

.survey-skip:hover {
  color: #0e7490;
}
</style>
