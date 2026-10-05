# Husky 和 Zustand 使用指南

## 📦 Husky - Git Hooks 管理工具

### 什么是 Husky？
Husky 可以让你在 Git 操作前自动运行脚本，比如在提交代码前检查代码质量。

### 当前配置

#### 1. pre-commit Hook
在每次 `git commit` 前自动运行，位置：`.husky/pre-commit`

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# 运行 TypeScript 类型检查
pnpm compile
```

**作用**：确保提交的代码没有 TypeScript 类型错误

#### 2. commit-msg Hook
在提交信息被保存前运行，位置：`.husky/commit-msg`

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# 验证提交信息不为空
commit_msg=$(cat "$1")
if [ -z "$commit_msg" ]; then
  echo "❌ 提交信息不能为空"
  exit 1
fi
```

**作用**：验证 commit message 格式

### 如何使用

1. **正常提交代码**：
```bash
git add .
git commit -m "feat: 添加新功能"
```

2. **如果遇到 Hook 报错**：
   - 修复代码中的类型错误
   - 或者临时跳过 Hook（不推荐）：
```bash
git commit --no-verify -m "临时提交"
```

### 添加更多 Hooks

创建新的 hook 文件：
```bash
# 在 commit 之前运行 lint
echo '#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

pnpm run lint' > .husky/pre-commit

# 给文件添加执行权限
chmod +x .husky/pre-commit
```

---

## 🐻 Zustand - 轻量级状态管理

### 什么是 Zustand？
Zustand 是一个简单、快速的 React 状态管理库，比 Redux 更轻量，比 Context API 性能更好。

### 核心概念

#### 1. 创建 Store
文件位置：`entrypoints/popup/store.ts`

```typescript
import { create } from 'zustand';

interface CounterState {
  count: number;
  increment: () => void;
}

export const useCounterStore = create<CounterState>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}));
```

#### 2. 在组件中使用

**方法 1：获取整个状态**
```tsx
function Counter() {
  const { count, increment } = useCounterStore();
  return <button onClick={increment}>{count}</button>;
}
```

**方法 2：使用选择器（推荐）**
```tsx
function Counter() {
  // 只订阅 count，increment 变化时不会重渲染
  const count = useCounterStore((state) => state.count);
  const increment = useCounterStore((state) => state.increment);
  return <button onClick={increment}>{count}</button>;
}
```

### 数据持久化

项目中的 store 使用了 `persist` 中间件，数据会自动保存到 `localStorage`：

```typescript
import { persist, createJSONStorage } from 'zustand/middleware';

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // 你的状态和 actions
    }),
    {
      name: 'app-storage', // localStorage 的 key
      storage: createJSONStorage(() => localStorage),
    }
  )
);
```

**效果**：
- 用户关闭扩展后再打开，数据依然存在
- 可以在开发者工具的 Application > Local Storage 中查看

### 高级用法

#### 1. 异步 Actions
```typescript
export const useStore = create<State>((set) => ({
  users: [],
  fetchUsers: async () => {
    const response = await fetch('/api/users');
    const users = await response.json();
    set({ users });
  },
}));
```

#### 2. 在 React 外部使用
```typescript
// 直接获取状态
const count = useAppStore.getState().count;

// 直接调用 action
useAppStore.getState().increment();

// 订阅状态变化
const unsubscribe = useAppStore.subscribe(
  (state) => console.log('count changed:', state.count)
);
```

#### 3. 使用 Immer 处理复杂状态
```bash
pnpm add immer
```

```typescript
import { immer } from 'zustand/middleware/immer';

export const useStore = create<State>()(
  immer((set) => ({
    nested: { deep: { value: 0 } },
    incrementDeep: () =>
      set((state) => {
        state.nested.deep.value += 1; // 直接修改，immer 会处理
      }),
  }))
);
```

### 最佳实践

1. **按功能拆分 Store**
```typescript
// stores/user.ts
export const useUserStore = create(...);

// stores/settings.ts
export const useSettingsStore = create(...);
```

2. **使用选择器避免不必要的重渲染**
```typescript
// ❌ 不好：任何状态变化都会重渲染
const store = useAppStore();

// ✅ 好：只有 count 变化才重渲染
const count = useAppStore((state) => state.count);
```

3. **导出类型安全的选择器**
```typescript
export const selectCount = (state: AppState) => state.count;
const count = useAppStore(selectCount);
```

---

## 🚀 实际开发流程

### 开发新功能
1. 在 `store.ts` 中添加新的状态和 actions
2. 在组件中使用 `useAppStore` hook
3. 测试功能
4. 提交代码（Husky 会自动检查类型）

### 示例：添加待办事项功能

```typescript
// store.ts
interface Todo {
  id: string;
  text: string;
  completed: boolean;
}

interface AppState {
  todos: Todo[];
  addTodo: (text: string) => void;
  toggleTodo: (id: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      todos: [],
      
      addTodo: (text: string) =>
        set((state) => ({
          todos: [
            ...state.todos,
            { id: Date.now().toString(), text, completed: false },
          ],
        })),

      toggleTodo: (id: string) =>
        set((state) => ({
          todos: state.todos.map((todo) =>
            todo.id === id ? { ...todo, completed: !todo.completed } : todo
          ),
        })),
    }),
    { name: 'todos-storage' }
  )
);
```

```tsx
// TodoList.tsx
function TodoList() {
  const todos = useAppStore((state) => state.todos);
  const addTodo = useAppStore((state) => state.addTodo);
  const toggleTodo = useAppStore((state) => state.toggleTodo);

  return (
    <div>
      <input onKeyPress={(e) => {
        if (e.key === 'Enter') {
          addTodo(e.currentTarget.value);
          e.currentTarget.value = '';
        }
      }} />
      {todos.map((todo) => (
        <div key={todo.id} onClick={() => toggleTodo(todo.id)}>
          {todo.completed ? '✅' : '⬜'} {todo.text}
        </div>
      ))}
    </div>
  );
}
```

---

## 📚 参考资源

- [Husky 官方文档](https://typicode.github.io/husky/)
- [Zustand 官方文档](https://docs.pmnd.rs/zustand/getting-started/introduction)
- [WXT 框架文档](https://wxt.dev/)

## 🛠️ 常见问题

**Q: Husky hooks 不生效？**
A: 运行 `pnpm install` 重新安装依赖，或手动运行 `pnpm prepare`

**Q: 如何禁用某个 hook？**
A: 删除对应的 `.husky/hook-name` 文件，或在文件中注释掉相关命令

**Q: Zustand 数据丢失？**
A: 检查是否正确配置了 `persist` 中间件，以及 localStorage 是否被清空

**Q: 如何在多个页面间共享 Zustand 状态？**
A: 在浏览器扩展中，popup、content script、background 是隔离的，需要使用 Chrome Storage API 或消息传递
