<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { TaskItem, TaskList } from '@tiptap/extension-list'

export interface DraftPayload {
  richText: string
  plainText: string
  charTotal: number
}

const emit = defineEmits<{ change: [payload: DraftPayload] }>()

function report() {
  if (!editor.value) return
  const text = editor.value.getText()
  emit('change', {
    richText: editor.value.getHTML(),
    plainText: text,
    charTotal: text.replace(/\s/g, '').length,
  })
}

const editor = useEditor({
  content: '',
  extensions: [
    StarterKit,
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: '在此撰写手册内容，支持标题、列表与表格…' }),
  ],
  onUpdate: report,
  onCreate: report,
})

function apply(fn: (chain: ReturnType<typeof editorChain>) => void) {
  if (!editor.value) return
  const chain = editor.value.chain().focus()
  fn(chain)
  chain.run()
}

function editorChain() {
  return editor.value!.chain()
}

function insertTable() {
  editor.value
    ?.chain()
    .focus()
    .insertTable({ rows: 3, cols: 4, withHeaderRow: true })
    .run()
}

function addColumnAfter() {
  editor.value?.chain().focus().addColumnAfter().run()
}

function deleteTable() {
  editor.value?.chain().focus().deleteTable().run()
}

function setDraft(html: string) {
  editor.value?.commands.setContent(html, { emitUpdate: false })
}

function resetDraft() {
  editor.value?.commands.clearContent(true)
}

onBeforeUnmount(() => {
  editor.value?.destroy()
})

defineExpose({ setDraft, resetDraft })
</script>

<template>
  <div class="compose-editor">
    <div v-if="editor" class="compose-toolbar">
      <button
        type="button"
        class="ct-btn"
        :class="{ on: editor.isActive('heading', { level: 2 }) }"
        title="小节标题"
        @click="apply((c) => c.toggleHeading({ level: 2 }))"
      >
        标题
      </button>
      <button
        type="button"
        class="ct-btn"
        :class="{ on: editor.isActive('bold') }"
        title="加粗"
        @click="apply((c) => c.toggleBold())"
      >
        B
      </button>
      <button
        type="button"
        class="ct-btn"
        :class="{ on: editor.isActive('bulletList') }"
        title="无序列表"
        @click="apply((c) => c.toggleBulletList())"
      >
        • 列表
      </button>
      <button
        type="button"
        class="ct-btn"
        :class="{ on: editor.isActive('orderedList') }"
        title="有序列表"
        @click="apply((c) => c.toggleOrderedList())"
      >
        1. 列表
      </button>
      <button
        type="button"
        class="ct-btn"
        :class="{ on: editor.isActive('taskList') }"
        title="待办清单"
        @click="apply((c) => c.toggleTaskList())"
      >
        待办
      </button>
      <button
        type="button"
        class="ct-btn"
        :class="{ on: editor.isActive('blockquote') }"
        title="引用"
        @click="apply((c) => c.toggleBlockquote())"
      >
        引用
      </button>
      <button type="button" class="ct-btn" title="插入表格" @click="insertTable">+ 表格</button>
      <button
        v-if="editor.isActive('table')"
        type="button"
        class="ct-btn"
        title="表格后加一列"
        @click="addColumnAfter"
      >
        + 列
      </button>
      <button v-if="editor.isActive('table')" type="button" class="ct-btn danger" title="删除表格" @click="deleteTable">
        删表
      </button>
      <button
        type="button"
        class="ct-btn"
        title="撤销"
        :disabled="!editor.can().undo()"
        @click="apply((c) => c.undo())"
      >
        撤销
      </button>
      <button
        type="button"
        class="ct-btn"
        title="重做"
        :disabled="!editor.can().redo()"
        @click="apply((c) => c.redo())"
      >
        重做
      </button>
    </div>

    <EditorContent :editor="editor" class="compose-canvas" />
  </div>
</template>

<style scoped>
.compose-editor {
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  overflow: hidden;
  background: var(--el-bg-color);
}

.compose-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
}

.ct-btn {
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: 12.5px;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.ct-btn:hover:not(:disabled) {
  background: var(--el-fill-color);
  color: var(--el-color-primary);
}

.ct-btn.on {
  border-color: var(--el-color-primary-light-7);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}

.ct-btn.danger:hover {
  color: var(--el-color-danger);
}

.ct-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.compose-canvas :deep(.tiptap) {
  min-height: 360px;
  padding: 18px 22px;
  outline: none;
  font-size: 14px;
  line-height: 1.9;
  color: var(--el-text-color-primary);
}

.compose-canvas :deep(.tiptap p.is-editor-empty:first-child)::before {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
  color: var(--el-text-color-placeholder);
}

.compose-canvas :deep(.tiptap h2) {
  font-size: 19px;
  font-weight: 600;
  margin: 16px 0 8px;
}

.compose-canvas :deep(.tiptap h3) {
  font-size: 16px;
  font-weight: 600;
  margin: 14px 0 8px;
}

.compose-canvas :deep(.tiptap ul),
.compose-canvas :deep(.tiptap ol) {
  padding-left: 22px;
  margin: 8px 0;
}

.compose-canvas :deep(.tiptap blockquote) {
  margin: 10px 0;
  padding: 6px 14px;
  border-left: 3px solid var(--el-color-primary-light-5);
  background: var(--el-fill-color-light);
  border-radius: 0 8px 8px 0;
}

.compose-canvas :deep(.tiptap table) {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 13px;
}

.compose-canvas :deep(.tiptap th),
.compose-canvas :deep(.tiptap td) {
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  text-align: left;
}

.compose-canvas :deep(.tiptap th) {
  background: var(--el-color-primary-light-9);
  font-weight: 600;
}

.compose-canvas :deep(.tiptap ul[data-type='taskList']) {
  padding-left: 4px;
  list-style: none;
}

.compose-canvas :deep(.tiptap ul[data-type='taskList'] li) {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.compose-canvas :deep(.tiptap ul[data-type='taskList'] input[type='checkbox']) {
  margin-top: 7px;
  accent-color: var(--el-color-primary);
}
</style>
