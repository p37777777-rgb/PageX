<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Clock } from '@element-plus/icons-vue'
import { getArticleBySlug, categories, libraryArticles } from './data'
import ManualBlockView from './components/ManualBlockView.vue'

const route = useRoute()
const router = useRouter()

const article = computed(() => getArticleBySlug(route.params.slug as string))

const categoryLabel = computed(
  () => categories.find((cat) => cat.key === article.value?.category)?.label ?? '',
)

const position = computed(() =>
  libraryArticles.findIndex((item) => item.slug === article.value?.slug),
)
const previous = computed(() =>
  position.value > 0 ? libraryArticles[position.value - 1] : undefined,
)
const following = computed(() =>
  position.value >= 0 && position.value < libraryArticles.length - 1
    ? libraryArticles[position.value + 1]
    : undefined,
)

watch(
  () => route.params.slug,
  () => {
    window.scrollTo({ top: 0 })
  },
)
</script>

<template>
  <article v-if="article" class="reader">
    <el-breadcrumb separator="/" class="reader-breadcrumb">
      <el-breadcrumb-item :to="{ path: '/manuals' }">手册广场</el-breadcrumb-item>
      <el-breadcrumb-item>{{ categoryLabel }}</el-breadcrumb-item>
      <el-breadcrumb-item>{{ article.title }}</el-breadcrumb-item>
    </el-breadcrumb>

    <header class="reader-head">
      <h1>{{ article.title }}</h1>
      <div class="head-meta">
        <span class="meta-dept">{{ article.department }} · {{ article.author }}</span>
        <span>发布于 {{ article.publishedOn }}</span>
        <span class="meta-read">
          <el-icon :size="13"><Clock /></el-icon>
          约 {{ article.readMinutes }} 分钟
        </span>
      </div>
      <div class="head-tags">
        <el-tag v-for="tag in article.tags" :key="tag" size="small" effect="plain" type="info">
          # {{ tag }}
        </el-tag>
      </div>
    </header>

    <div class="reader-body">
      <ManualBlockView v-for="(block, index) in article.blocks" :key="index" :block="block" />
    </div>

    <nav class="reader-pager">
      <button
        v-if="previous"
        type="button"
        class="pager-cell"
        @click="router.push(`/manuals/read/${previous.slug}`)"
      >
        <el-icon :size="14"><ArrowLeft /></el-icon>
        <span class="pager-body">
          <em>上一篇</em>
          <strong>{{ previous.title }}</strong>
        </span>
      </button>
      <span v-else class="pager-blank" />
      <button
        v-if="following"
        type="button"
        class="pager-cell align-end"
        @click="router.push(`/manuals/read/${following.slug}`)"
      >
        <span class="pager-body">
          <em>下一篇</em>
          <strong>{{ following.title }}</strong>
        </span>
        <el-icon :size="14"><ArrowRight /></el-icon>
      </button>
      <span v-else class="pager-blank" />
    </nav>
  </article>

  <el-card v-else shadow="never" class="reader-missing">
    <el-empty description="手册不存在或已被撤下">
      <el-button type="primary" @click="router.push('/manuals')">返回手册广场</el-button>
    </el-empty>
  </el-card>
</template>

<style scoped>
.reader {
  padding: 22px 26px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  background: var(--el-bg-color);
}

.reader-breadcrumb {
  margin-bottom: 14px;
}

.reader-head h1 {
  margin: 0 0 10px;
  font-size: 23px;
  line-height: 1.4;
  color: var(--el-text-color-primary);
}

.head-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  font-size: 12.5px;
  color: var(--el-text-color-secondary);
}

.meta-dept {
  color: var(--el-text-color-regular);
}

.meta-read {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.head-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.reader-body {
  margin-top: 18px;
}

.reader-pager {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.pager-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 46%;
  padding: 10px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: transparent;
  color: var(--el-text-color-regular);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.pager-cell:hover {
  border-color: var(--el-color-primary-light-5);
  color: var(--el-color-primary);
}

.pager-cell.align-end {
  margin-left: auto;
  text-align: right;
}

.pager-blank {
  flex: 1;
}

.pager-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.pager-body em {
  font-style: normal;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.pager-body strong {
  font-size: 13px;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reader-missing {
  border-radius: 12px;
}
</style>
