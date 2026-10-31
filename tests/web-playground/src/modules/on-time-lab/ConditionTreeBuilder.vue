<script setup lang="ts">
import { inject } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import {
  FILTER_FIELDS,
  OPERATOR_LABELS,
  fieldMeta,
  operatorsForField,
} from './engine'
import { TREE_OPS_KEY } from './types'
import type { CompareOperator, FilterField, FilterGroup, FilterRule, TreeOps } from './types'

const props = withDefaults(
  defineProps<{
    group: FilterGroup
    depth?: number
  }>(),
  { depth: 0 },
)

const ops = inject<TreeOps>(
  TREE_OPS_KEY,
  { addRule: () => {}, addSubgroup: () => {}, removeNode: () => {} },
)

const isRoot = props.depth === 0

function onFieldChange(rule: FilterRule, field: FilterField) {
  rule.field = field
  rule.operator = operatorsForField(field)[0]
  const meta = fieldMeta(field)
  rule.value = meta.options ? meta.options[0] : 0
}

function onOperatorChange(rule: FilterRule, operator: CompareOperator) {
  rule.operator = operator
}
</script>

<template>
  <div class="ctb-group" :class="[isRoot ? 'is-root' : 'is-nested', `is-${group.logic.toLowerCase()}`]">
    <div class="ctb-head">
      <el-radio-group
        :model-value="group.logic"
        size="small"
        @update:model-value="group.logic = $event as 'AND' | 'OR'"
      >
        <el-radio-button value="AND">AND</el-radio-button>
        <el-radio-button value="OR">OR</el-radio-button>
      </el-radio-group>
      <span class="ctb-logic-hint">{{ group.logic === 'AND' ? '同时满足全部子条件' : '满足任一子条件即可' }}</span>
      <span class="ctb-head-gap" />
      <el-button size="small" text type="primary" @click="ops.addRule(group.id)">
        <el-icon><Plus /></el-icon>&nbsp;基础条件
      </el-button>
      <el-button size="small" text @click="ops.addSubgroup(group.id)">
        <el-icon><Plus /></el-icon>&nbsp;嵌套条件组
      </el-button>
      <el-button
        v-if="!isRoot"
        size="small"
        text
        type="danger"
        @click="ops.removeNode(group.id)"
      >
        <el-icon><Delete /></el-icon>
      </el-button>
    </div>

    <p v-if="group.children.length === 0" class="ctb-empty">
      本组暂无条件，用上方按钮添加基础条件或嵌套子组
    </p>

    <div v-for="(child, index) in group.children" :key="child.id" class="ctb-node">
      <span class="ctb-join" :class="{ 'is-first': index === 0 }">
        {{ index === 0 ? '当' : group.logic }}
      </span>
      <ConditionTreeBuilder
        v-if="child.kind === 'group'"
        :group="child"
        :depth="depth + 1"
      />
      <div v-else class="ctb-rule">
        <el-select
          :model-value="child.field"
          size="small"
          class="ctb-field"
          @update:model-value="(field: FilterField) => onFieldChange(child, field)"
        >
          <el-option
            v-for="meta in FILTER_FIELDS"
            :key="meta.field"
            :value="meta.field"
            :label="meta.label"
          />
        </el-select>
        <el-select
          :model-value="child.operator"
          size="small"
          class="ctb-operator"
          @update:model-value="(op: CompareOperator) => onOperatorChange(child, op)"
        >
          <el-option
            v-for="op in operatorsForField(child.field)"
            :key="op"
            :value="op"
            :label="OPERATOR_LABELS[op]"
          />
        </el-select>
        <el-select
          v-if="fieldMeta(child.field).options"
          :model-value="child.value"
          size="small"
          class="ctb-value"
          @update:model-value="(value: string) => (child.value = value)"
        >
          <el-option
            v-for="option in fieldMeta(child.field).options"
            :key="option"
            :value="option"
            :label="option"
          />
        </el-select>
        <el-input-number
          v-else
          :model-value="Number(child.value)"
          size="small"
          class="ctb-value"
          :precision="fieldMeta(child.field).precision"
          :step="fieldMeta(child.field).precision === 0 ? 1 : 5"
          controls-position="right"
          @update:model-value="(value: number | undefined) => (child.value = value ?? 0)"
        />
        <el-button size="small" text type="danger" @click="ops.removeNode(child.id)">
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ctb-group {
  border: 1px solid #b8d8e0;
  border-radius: 8px;
  background: #fbfeff;
  padding: 10px 12px;
}

.ctb-group.is-nested {
  margin: 8px 0 0 0;
  background: #f4fafb;
  border-style: dashed;
}

.ctb-group.is-or {
  border-color: #d9b06c;
}

.ctb-group.is-or.is-nested {
  background: #fdf9f1;
}

.ctb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ctb-logic-hint {
  font-size: 11.5px;
  color: #7d93a3;
}

.ctb-head-gap {
  flex: 1;
}

.ctb-empty {
  margin: 10px 0 2px;
  font-size: 12px;
  color: #9db1bd;
}

.ctb-node {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 8px;
}

.ctb-join {
  flex: none;
  width: 30px;
  padding: 5px 0;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  color: #0e7490;
  background: rgba(14, 116, 144, 0.1);
  border-radius: 4px;
  user-select: none;
}

.ctb-join.is-first {
  color: #8aa0ad;
  background: #eef3f5;
}

.is-or .ctb-join:not(.is-first) {
  color: #b07a1e;
  background: rgba(217, 176, 108, 0.16);
}

.ctb-node > .ctb-group {
  flex: 1;
  min-width: 0;
}

.ctb-rule {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border: 1px solid #e2ecf0;
  border-radius: 6px;
  background: #fff;
}

.ctb-field {
  width: 168px;
}

.ctb-operator {
  width: 116px;
}

.ctb-value {
  flex: 1;
  min-width: 120px;
}
</style>
