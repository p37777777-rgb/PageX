<script setup lang="ts">
import { ref } from 'vue'
import { ArrowDown, ArrowUp, Close, CopyDocument } from '@element-plus/icons-vue'

defineProps<{
  steps: string[]
  prompt?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const collapsed = ref(false)
const copied = ref(false)

async function copyPrompt(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    document.body.removeChild(area)
  }
  copied.value = true
  window.setTimeout(() => {
    copied.value = false
  }, 1600)
}
</script>

<template>
  <section class="brief" :class="{ collapsed }">
    <header class="brief-head">
      <span class="brief-tag">任务简报</span>
      <span class="brief-note">阅后即焚 · 发给 Agent 后请关闭</span>
      <button type="button" class="brief-op" :title="collapsed ? '展开' : '收起'" @click="collapsed = !collapsed">
        <el-icon :size="14">
          <ArrowUp v-if="!collapsed" />
          <ArrowDown v-else />
        </el-icon>
      </button>
      <button type="button" class="brief-op" title="关闭简报" @click="emit('close')">
        <el-icon :size="14"><Close /></el-icon>
      </button>
    </header>

    <div v-show="!collapsed" class="brief-body">
      <div v-if="prompt" class="brief-prompt">
        <p>{{ prompt }}</p>
        <button type="button" class="copy-btn" @click="copyPrompt(prompt)">
          <el-icon :size="13"><CopyDocument /></el-icon>
          {{ copied ? '已复制' : '复制指令' }}
        </button>
      </div>
      <ol class="brief-steps">
        <li v-for="(step, index) in steps" :key="index">{{ step }}</li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.brief {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 60;
  width: 372px;
  max-width: calc(100vw - 40px);
  border: 1px solid rgba(14, 116, 144, 0.18);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 18px 44px rgba(11, 26, 46, 0.18);
  overflow: hidden;
}

.brief-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: linear-gradient(135deg, #0b1a2e, #123246);
}

.brief-tag {
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(45, 212, 238, 0.16);
  color: #7ce7f7;
  font-size: 12px;
  letter-spacing: 1px;
}

.brief-note {
  flex: 1;
  color: #8ba3bf;
  font-size: 11px;
}

.brief-op {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #8ba3bf;
  cursor: pointer;
}

.brief-op:hover {
  background: rgba(139, 163, 191, 0.15);
  color: #e8f0f8;
}

.brief-body {
  max-height: 46vh;
  overflow-y: auto;
  padding: 12px 14px 14px;
}

.brief-prompt {
  position: relative;
  padding: 10px 12px;
  border-left: 3px solid var(--ops-cyan, #2dd4ee);
  border-radius: 6px;
  background: #f2f8fa;
}

.brief-prompt p {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.7;
  color: #274357;
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: 1px solid rgba(14, 116, 144, 0.35);
  border-radius: 999px;
  background: #fff;
  color: #0e7490;
  font-size: 12px;
  cursor: pointer;
}

.copy-btn:hover {
  background: #e9f3f6;
}

.brief-steps {
  margin: 12px 0 0;
  padding: 0 0 0 20px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.brief-steps li {
  font-size: 12.5px;
  line-height: 1.65;
  color: #33475c;
}
</style>
