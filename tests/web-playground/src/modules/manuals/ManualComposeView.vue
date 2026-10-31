<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Document, Plus, Promotion } from '@element-plus/icons-vue'
import ManualDocEditor from './components/ManualDocEditor.vue'
import type { DraftPayload } from './components/ManualDocEditor.vue'
import { useAuthoredStore } from './store'
import type { AuthoredManual } from './types'

const route = useRoute()
const router = useRouter()
const store = useAuthoredStore()

const editorRef = ref<InstanceType<typeof ManualDocEditor> | null>(null)

const docTitle = ref('')
const labels = ref<string[]>([])
const labelInput = ref('')
const richText = ref('')
const plainText = ref('')
const charTotal = ref(0)
const dirty = ref(false)
const editingId = ref<string | null>(null)
const savedAt = ref<number | null>(null)

const activeTab = computed(() => (route.query.tab === 'mine' ? 'mine' : 'editor'))

function switchTab(tab: 'editor' | 'mine') {
  router.push(tab === 'mine' ? '/manuals/compose?tab=mine' : '/manuals/compose')
}

function onDraftChange(payload: DraftPayload) {
  richText.value = payload.richText
  plainText.value = payload.plainText
  charTotal.value = payload.charTotal
  dirty.value = true
}

function addLabel() {
  const value = labelInput.value.trim()
  if (!value) {
    ElMessage.warning('请输入标签名称')
    return
  }
  if (labels.value.includes(value)) {
    ElMessage.info('该标签已存在')
    labelInput.value = ''
    return
  }
  labels.value.push(value)
  labelInput.value = ''
  dirty.value = true
}

function removeLabel(label: string) {
  labels.value = labels.value.filter((item) => item !== label)
  dirty.value = true
}

function startNewDoc(silent = false) {
  editingId.value = null
  docTitle.value = ''
  labels.value = []
  labelInput.value = ''
  richText.value = ''
  plainText.value = ''
  charTotal.value = 0
  savedAt.value = null
  dirty.value = false
  editorRef.value?.resetDraft()
  if (!silent) ElMessage.info('已切换到新文档')
}

function loadDoc(doc: AuthoredManual) {
  editingId.value = doc.id
  docTitle.value = doc.title
  labels.value = [...doc.labels]
  labelInput.value = ''
  richText.value = doc.richText
  plainText.value = doc.plainText
  charTotal.value = doc.charTotal
  savedAt.value = doc.revisedAt
  dirty.value = false
  editorRef.value?.setDraft(doc.richText)
  switchTab('editor')
}

function saveDoc() {
  const title = docTitle.value.trim()
  if (title.length < 2) {
    ElMessage.error('请先填写文档标题（至少 2 个字符）')
    return
  }
  if (charTotal.value < 50) {
    ElMessage.error('正文内容过短，至少 50 字')
    return
  }
  const now = Date.now()
  const existing = editingId.value ? store.getById(editingId.value) : undefined
  const doc: AuthoredManual = {
    id: existing?.id ?? `lm-${now}`,
    title,
    labels: [...labels.value],
    richText: richText.value,
    plainText: plainText.value,
    charTotal: charTotal.value,
    savedAt: existing?.savedAt ?? now,
    revisedAt: now,
  }
  store.upsert(doc)
  editingId.value = doc.id
  savedAt.value = now
  dirty.value = false
  ElMessage.success('文档已保存，可在「我的文档」中查看')
}

async function deleteDoc(id: string) {
  try {
    await ElMessageBox.confirm('删除后无法恢复，确定删除该文档吗？', '删除文档', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  store.remove(id)
  if (editingId.value === id) {
    startNewDoc(true)
  }
  ElMessage.success('文档已删除')
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

watch(store.resetEpoch, () => {
  startNewDoc(true)
})
</script>

<template>
  <div class="compose">
    <header class="compose-tabs">
      <button
        type="button"
        class="tab-btn"
        :class="{ current: activeTab === 'editor' }"
        @click="switchTab('editor')"
      >
        <el-icon :size="14"><Promotion /></el-icon>
        编辑文档
      </button>
      <button
        type="button"
        class="tab-btn"
        :class="{ current: activeTab === 'mine' }"
        @click="switchTab('mine')"
      >
        <el-icon :size="14"><Document /></el-icon>
        我的文档
        <span class="tab-badge">{{ store.authored.value.length }}</span>
      </button>
    </header>

    <section v-if="activeTab === 'editor'" class="compose-panel">
      <el-input
        v-model="docTitle"
        class="title-input"
        placeholder="请输入文档标题"
        aria-label="文档标题"
        size="large"
      />

      <div class="label-row">
        <span class="label-name">标签</span>
        <el-tag
          v-for="label in labels"
          :key="label"
          closable
          effect="light"
          class="label-tag"
          @close="removeLabel(label)"
        >
          {{ label }}
        </el-tag>
        <el-input
          v-model="labelInput"
          class="label-input"
          placeholder="输入标签后回车或点击添加"
          aria-label="标签输入"
          @keyup.enter="addLabel"
        />
        <el-button type="primary" plain :icon="Plus" @click="addLabel">添加标签</el-button>
      </div>

      <ManualDocEditor ref="editorRef" @change="onDraftChange" />

      <footer class="compose-footer">
        <span class="foot-status">
          <template v-if="dirty">有未保存的修改</template>
          <template v-else-if="savedAt">已于 {{ formatTime(savedAt) }} 保存</template>
          <template v-else>尚未保存</template>
        </span>
        <span class="foot-count">{{ charTotal }} 字</span>
        <el-button type="primary" size="large" data-action="save-manual" @click="saveDoc">
          保存文档
        </el-button>
      </footer>
    </section>

    <section v-else class="mine-panel">
      <div class="mine-head">
        <div>
          <h3>我的文档</h3>
          <p>此处收录你保存的全部文档，本地留档，刷新不丢。</p>
        </div>
        <el-button type="primary" :icon="Plus" @click="startNewDoc()">新建文档</el-button>
      </div>

      <el-empty v-if="store.authored.value.length === 0" description="还没有保存过文档，去编辑页写一篇吧" />

      <div v-else class="mine-list">
        <div v-for="doc in store.authored.value" :key="doc.id" class="mine-item">
          <div class="item-body">
            <span class="item-title">{{ doc.title }}</span>
            <span class="item-meta">
              保存于 {{ formatTime(doc.revisedAt) }} · {{ doc.charTotal }} 字
            </span>
            <span v-if="doc.labels.length" class="item-labels">
              <el-tag
                v-for="label in doc.labels"
                :key="label"
                size="small"
                effect="plain"
                type="info"
              >
                {{ label }}
              </el-tag>
            </span>
          </div>
          <div class="item-actions">
            <el-button size="small" type="primary" plain @click="loadDoc(doc)">编辑</el-button>
            <el-button size="small" type="danger" plain :icon="Delete" @click="deleteDoc(doc.id)">
              删除
            </el-button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.compose {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.compose-tabs {
  display: flex;
  gap: 6px;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 18px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font-size: 13.5px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.tab-btn:hover {
  border-color: var(--el-color-primary-light-5);
  color: var(--el-color-primary);
}

.tab-btn.current {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}

.tab-badge {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 11px;
  text-align: center;
}

.compose-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.title-input :deep(.el-input__inner) {
  font-size: 20px;
  font-weight: 600;
}

.label-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  background: var(--el-bg-color);
}

.label-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.label-tag {
  font-size: 12.5px;
}

.label-input {
  width: 220px;
}

.compose-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
}

.foot-status {
  margin-right: auto;
  font-size: 12.5px;
  color: var(--el-text-color-secondary);
}

.foot-count {
  font-size: 12.5px;
  color: var(--el-text-color-secondary);
}

.mine-panel {
  padding: 18px 20px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  background: var(--el-bg-color);
}

.mine-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.mine-head h3 {
  margin: 0 0 4px;
  font-size: 16px;
  color: var(--el-text-color-primary);
}

.mine-head p {
  margin: 0;
  font-size: 12.5px;
  color: var(--el-text-color-secondary);
}

.mine-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mine-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  transition: border-color 0.15s;
}

.mine-item:hover {
  border-color: var(--el-color-primary-light-5);
}

.item-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.item-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.item-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.item-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.item-actions {
  display: flex;
  gap: 6px;
  flex: none;
}
</style>
