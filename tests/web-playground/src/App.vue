<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Promotion } from '@element-plus/icons-vue'
import BriefPanel from './shell/BriefPanel.vue'
import InspectorPanel from './shell/InspectorPanel.vue'
import { modules } from './modules/registry'

const route = useRoute()
const router = useRouter()

const current = computed(
  () => modules.find((module) => module.id === route.meta.moduleId) ?? modules[0],
)

const isLedger = computed(() => route.name === 'fare-audit-ledger')
const isFullBleed = computed(() => current.value.fullBleed === true)

const dismissedBriefs = ref<Record<string, boolean>>({})
const briefVisible = computed(
  () =>
    !isLedger.value &&
    current.value.steps.length > 0 &&
    !dismissedBriefs.value[current.value.id],
)

function openModule(id: string) {
  router.push(`/${id}`)
}

function dismissBrief() {
  dismissedBriefs.value[current.value.id] = true
}
</script>

<template>
  <div class="ops-shell">
    <aside class="rail">
      <div class="brand">
        <span class="brand-badge">
          <el-icon :size="17"><Promotion /></el-icon>
        </span>
        <div class="brand-copy">
          <strong>凌越航空</strong>
          <small>智慧运行平台</small>
        </div>
      </div>

      <nav class="rail-nav">
        <button
          v-for="module in modules"
          :key="module.id"
          type="button"
          class="rail-item"
          :class="{ active: current.id === module.id }"
          @click="openModule(module.id)"
        >
          <el-icon :size="16">
            <component :is="module.icon" />
          </el-icon>
          <span>{{ module.title }}</span>
        </button>
      </nav>

      <div class="rail-foot">
        <InspectorPanel />
        <p class="rail-meta">v5.2.0 · build 3187</p>
      </div>
    </aside>

    <div class="workspace">
      <header class="module-bar">
        <div class="module-copy">
          <h2>{{ current.title }}</h2>
          <p>{{ current.blurb }}</p>
        </div>
        <button
          v-if="!briefVisible && current.steps.length > 0 && !isLedger"
          type="button"
          class="brief-reopen"
          @click="dismissedBriefs[current.id] = false"
        >
          重新打开任务简报
        </button>
      </header>

      <main class="stage" :class="{ flush: isFullBleed }">
        <router-view />
      </main>
    </div>

    <BriefPanel
      v-if="briefVisible"
      :steps="current.steps"
      :prompt="current.prompt"
      @close="dismissBrief"
    />
  </div>
</template>

<style scoped>
.ops-shell {
  display: flex;
  height: 100%;
}

.rail {
  display: flex;
  flex-direction: column;
  flex: none;
  width: 224px;
  background: linear-gradient(180deg, var(--ops-navy) 0%, var(--ops-navy-deep) 100%);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px 14px;
}

.brand-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: rgba(45, 212, 238, 0.14);
  color: var(--ops-cyan);
}

.brand-copy {
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}

.brand-copy strong {
  color: var(--ops-rail-text-strong);
  font-size: 15px;
  letter-spacing: 1px;
}

.brand-copy small {
  color: var(--ops-rail-text);
  font-size: 11px;
}

.rail-nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rail-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ops-rail-text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}

.rail-item:hover {
  background: rgba(139, 163, 191, 0.12);
  color: var(--ops-rail-text-strong);
}

.rail-item.active {
  background: rgba(45, 212, 238, 0.13);
  color: var(--ops-cyan);
  box-shadow: inset 2.5px 0 0 var(--ops-cyan);
}

.rail-foot {
  padding: 12px 14px 14px;
  border-top: 1px solid rgba(139, 163, 191, 0.14);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rail-meta {
  margin: 0;
  color: #4d647f;
  font-size: 10.5px;
  letter-spacing: 0.5px;
}

.workspace {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.module-bar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 26px;
  background: #fff;
  border-bottom: 1px solid #e4ebf1;
}

.module-copy h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--ops-ink);
}

.module-copy p {
  margin: 3px 0 0;
  font-size: 12.5px;
  color: #6b7f92;
}

.brief-reopen {
  flex: none;
  padding: 5px 12px;
  border: 1px solid rgba(14, 116, 144, 0.3);
  border-radius: 999px;
  background: #fff;
  color: #0e7490;
  font-size: 12px;
  cursor: pointer;
}

.brief-reopen:hover {
  background: #e9f3f6;
}

.stage {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 22px 26px;
}

.stage.flush {
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.stage.flush > :deep(*) {
  flex: 1;
  min-height: 0;
}
</style>
