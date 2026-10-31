<script setup lang="ts">
import type { ManualBlock } from '../types'

defineProps<{ block: ManualBlock }>()
</script>

<template>
  <h2 v-if="block.kind === 'heading' && block.level === 2" class="handbook-h2">
    {{ block.text }}
  </h2>
  <h3 v-else-if="block.kind === 'heading'" class="handbook-h3">
    {{ block.text }}
  </h3>

  <p v-else-if="block.kind === 'paragraph'" class="handbook-paragraph">
    {{ block.text }}
  </p>

  <ol v-else-if="block.kind === 'list' && block.ordered" class="handbook-list">
    <li v-for="(item, index) in block.items" :key="index">{{ item }}</li>
  </ol>
  <ul v-else-if="block.kind === 'list'" class="handbook-list">
    <li v-for="(item, index) in block.items" :key="index">{{ item }}</li>
  </ul>

  <figure v-else-if="block.kind === 'table'" class="handbook-table-figure">
    <table class="handbook-table">
      <thead>
        <tr>
          <th v-for="(header, index) in block.headers" :key="index">{{ header }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, rowIndex) in block.rows" :key="rowIndex">
          <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
        </tr>
      </tbody>
    </table>
    <figcaption v-if="block.note" class="handbook-caption">▲ {{ block.note }}</figcaption>
  </figure>

  <blockquote v-else-if="block.kind === 'quote'" class="handbook-quote">
    <p>{{ block.text }}</p>
    <footer v-if="block.source">—— {{ block.source }}</footer>
  </blockquote>
</template>

<style scoped>
.handbook-h2,
.handbook-h3 {
  margin: 26px 0 10px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--el-text-color-primary);
}

.handbook-h2 {
  font-size: 19px;
  padding-left: 10px;
  border-left: 4px solid var(--el-color-primary);
}

.handbook-h3 {
  font-size: 16px;
}

.handbook-paragraph {
  margin: 0 0 14px;
  font-size: 14px;
  line-height: 1.9;
  color: var(--el-text-color-regular);
}

.handbook-list {
  margin: 0 0 14px;
  padding-left: 22px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--el-text-color-regular);
}

.handbook-table-figure {
  margin: 0 0 18px;
  overflow-x: auto;
}

.handbook-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.handbook-table th,
.handbook-table td {
  padding: 9px 12px;
  border: 1px solid var(--el-border-color-lighter);
  text-align: left;
  line-height: 1.6;
}

.handbook-table th {
  background: var(--el-color-primary-light-9);
  font-weight: 600;
  color: var(--el-color-primary-dark-2);
}

.handbook-table td {
  color: var(--el-text-color-regular);
}

.handbook-table tr:nth-child(even) td {
  background: var(--el-fill-color-lighter);
}

.handbook-caption {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.handbook-quote {
  margin: 0 0 18px;
  padding: 10px 16px;
  border-left: 3px solid var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
  border-radius: 0 10px 10px 0;
}

.handbook-quote p {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.8;
  color: var(--el-text-color-regular);
}

.handbook-quote footer {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
