<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Collection, Document, EditPen, Notebook } from '@element-plus/icons-vue'
import { useModuleProbe } from '../../probe'
import { categories, countByCategory } from './data'
import { auditManuals } from './audit'
import { useAuthoredStore } from './store'
import type { CategoryKey } from './types'

const route = useRoute()
const router = useRouter()
const store = useAuthoredStore()

useModuleProbe('manuals', {
  runChecks: () => auditManuals({ authored: store.authored.value }),
  resetModule: () => store.clearAll(),
})

const activeCategory = computed(() => (route.query.cat as string) ?? 'all')

const navItems = [
  { key: 'plaza', label: '手册广场', to: '/manuals', icon: Collection },
  { key: 'compose', label: '编写台', to: '/manuals/compose', icon: EditPen },
  { key: 'mine', label: '我的文档', to: '/manuals/compose?tab=mine', icon: Document },
] as const

const activeNav = computed(() => {
  if (route.name === 'manuals-compose') {
    return route.query.tab === 'mine' ? 'mine' : 'compose'
  }
  return 'plaza'
})

function goCategory(key: string) {
  router.push(key === 'all' ? '/manuals' : { path: '/manuals', query: { cat: key } })
}

const sidebarItems = computed(() => [
  { key: 'all', label: '全部手册', intro: '手册库全量文档', count: 6 },
  ...categories.map((cat) => ({
    key: cat.key as string,
    label: cat.label,
    intro: cat.intro,
    count: countByCategory(cat.key as CategoryKey),
  })),
])
</script>

<template>
  <div class="manual-hub">
    <header class="hub-topbar">
      <div class="hub-brand">
        <el-icon :size="20" class="brand-glyph"><Notebook /></el-icon>
        <div class="brand-text">
          <strong>凌越运行手册库</strong>
          <span>运行标准 · 一处归档 · 全员可查</span>
        </div>
      </div>
      <nav class="hub-nav" aria-label="手册中心导航">
        <button
          v-for="item in navItems"
          :key="item.key"
          type="button"
          class="nav-link"
          :class="{ current: activeNav === item.key }"
          @click="router.push(item.to)"
        >
          {{ item.label }}
        </button>
      </nav>
    </header>

    <div class="hub-body">
      <aside class="hub-sidebar">
        <div class="side-title">文档分类</div>
        <button
          v-for="item in sidebarItems"
          :key="item.key"
          type="button"
          class="side-item"
          :class="{ picked: activeCategory === item.key }"
          @click="goCategory(item.key)"
        >
          <span class="side-label">{{ item.label }}</span>
          <span class="side-count">{{ item.count }}</span>
        </button>
      </aside>

      <main class="hub-stage">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.manual-hub {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.hub-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 14px 20px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  background:
    linear-gradient(120deg, var(--el-color-primary-light-9) 0%, var(--el-bg-color) 55%);
}

.hub-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--el-color-primary);
  color: #fff;
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.brand-text strong {
  font-size: 16px;
  color: var(--el-text-color-primary);
}

.brand-text span {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.hub-nav {
  display: flex;
  gap: 6px;
}

.nav-link {
  padding: 8px 16px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: 13.5px;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.nav-link:hover {
  background: var(--el-fill-color);
  color: var(--el-color-primary);
}

.nav-link.current {
  border-color: var(--el-color-primary-light-7);
  background: var(--el-bg-color);
  color: var(--el-color-primary);
  font-weight: 600;
}

.hub-body {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.hub-sidebar {
  flex: none;
  position: sticky;
  top: 12px;
  width: 224px;
  padding: 14px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  background: var(--el-bg-color);
}

.side-title {
  margin-bottom: 8px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  letter-spacing: 0.08em;
}

.side-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.side-item:hover {
  background: var(--el-fill-color);
}

.side-item.picked {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}

.side-count {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--el-fill-color);
  font-size: 11.5px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.side-item.picked .side-count {
  background: var(--el-color-primary);
  color: #fff;
}

.hub-stage {
  flex: 1;
  min-width: 0;
}

@media (max-width: 900px) {
  .hub-body {
    flex-direction: column;
  }

  .hub-sidebar {
    position: static;
    width: 100%;
  }
}
</style>
