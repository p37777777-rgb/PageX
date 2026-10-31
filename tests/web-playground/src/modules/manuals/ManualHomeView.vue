<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight, Search } from '@element-plus/icons-vue'
import { categories, libraryArticles } from './data'

const route = useRoute()
const router = useRouter()

const keyword = ref((route.query.q as string) ?? '')

const activeCategory = computed(() => (route.query.cat as string) ?? 'all')

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return libraryArticles.filter((article) => {
    if (activeCategory.value !== 'all' && article.category !== activeCategory.value) {
      return false
    }
    if (!kw) return true
    return (
      article.title.toLowerCase().includes(kw) ||
      article.digest.toLowerCase().includes(kw) ||
      article.tags.some((tag) => tag.toLowerCase().includes(kw))
    )
  })
})

const activeLabel = computed(() => {
  if (activeCategory.value === 'all') return '全部手册'
  return categories.find((cat) => cat.key === activeCategory.value)?.label ?? '全部手册'
})

function openArticle(slug: string) {
  router.push(`/manuals/read/${slug}`)
}

function toCompose() {
  router.push('/manuals/compose')
}
</script>

<template>
  <div class="plaza">
    <section class="plaza-head">
      <div class="head-copy">
        <h2>手册广场</h2>
        <p>
          当前分类「{{ activeLabel }}」共 {{ filtered.length }} 篇文档，覆盖机队、工程、训练、数据与预算等运行场景。
        </p>
      </div>
      <el-input
        v-model="keyword"
        class="head-search"
        :prefix-icon="Search"
        placeholder="搜索标题、摘要或标签"
        clearable
        aria-label="搜索手册"
      />
    </section>

    <section class="doc-grid">
      <button
        v-for="article in filtered"
        :key="article.slug"
        type="button"
        class="doc-card"
        @click="openArticle(article.slug)"
      >
        <div class="card-top">
          <span class="card-cat">{{
            categories.find((cat) => cat.key === article.category)?.label
          }}</span>
          <span class="card-date">{{ article.publishedOn }}</span>
        </div>
        <h3 class="card-title">{{ article.title }}</h3>
        <p class="card-digest">{{ article.digest }}</p>
        <div class="card-foot">
          <span class="card-meta">{{ article.department }} · {{ article.author }}</span>
          <span class="card-tags">
            <em v-for="tag in article.tags.slice(0, 3)" :key="tag">#{{ tag }}</em>
          </span>
        </div>
      </button>

      <el-empty v-if="filtered.length === 0" description="没有匹配的文档，换个关键词试试" class="plaza-empty" />
    </section>

    <section class="plaza-cta">
      <div class="cta-text">
        <strong>需要汇总多篇文档？</strong>
        <span>把分散在手册里的信息整理成一份新文档，到编写台完成汇编。</span>
      </div>
      <el-button type="primary" :icon="ArrowRight" @click="toCompose">
        前往编写台
      </el-button>
    </section>
  </div>
</template>

<style scoped>
.plaza {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.plaza-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  background: var(--el-bg-color);
}

.head-copy h2 {
  margin: 0 0 6px;
  font-size: 18px;
  color: var(--el-text-color-primary);
}

.head-copy p {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.head-search {
  width: 280px;
  flex: none;
}

.doc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.doc-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 18px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  background: var(--el-bg-color);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}

.doc-card:hover {
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 6px 18px rgba(14, 116, 144, 0.12);
  transform: translateY(-2px);
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-cat {
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 11.5px;
  font-weight: 600;
}

.card-date {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.card-title {
  margin: 0;
  font-size: 15.5px;
  line-height: 1.4;
  color: var(--el-text-color-primary);
}

.card-digest {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--el-border-color-lighter);
}

.card-meta {
  font-size: 11.5px;
  color: var(--el-text-color-secondary);
}

.card-tags {
  display: flex;
  gap: 6px;
  overflow: hidden;
}

.card-tags em {
  font-style: normal;
  font-size: 11.5px;
  color: var(--el-color-primary-light-3);
  white-space: nowrap;
}

.plaza-empty {
  grid-column: 1 / -1;
}

.plaza-cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  border: 1px dashed var(--el-color-primary-light-5);
  border-radius: 12px;
  background: var(--el-color-primary-light-9);
}

.cta-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cta-text strong {
  font-size: 13.5px;
  color: var(--el-color-primary-dark-2);
}

.cta-text span {
  font-size: 12.5px;
  color: var(--el-text-color-secondary);
}

@media (max-width: 760px) {
  .plaza-head {
    flex-direction: column;
    align-items: stretch;
  }

  .head-search {
    width: 100%;
  }
}
</style>
