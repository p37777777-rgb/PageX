# Husky 和 Zustand 使用指南

## 📦 Husky - Git Hooks 管理工具

### 什么是 Husky？
Husky 把项目脚本接到本地 Git 操作上。检查失败时阻止本次操作，方便尽早发现问题；它不会自动提交、推送或修改业务代码。

### 当前配置

当前项目使用 Husky 9，保留 `package.json` 中的 `"prepare": "husky"`。钩子直接写命令，不再引入旧的 `_/husky.sh`。

| 时机 | 文件 | 检查内容 |
| --- | --- | --- |
| 提交前 | `.husky/pre-commit` | `pnpm compile`，TypeScript 类型检查 |
| 提交信息保存后、创建提交前 | `.husky/commit-msg` | 首行符合 `type(scope): description` 格式 |
| 推送前 | `.husky/pre-push` | `pnpm test --passWithNoTests`，运行 Vitest 单元测试 |

当前没有测试文件，所以推送检查暂时允许空测试集，并显示 `No test files found`；这不代表已有测试覆盖。添加首批单元测试后，删除 `.husky/pre-push` 中的 `--passWithNoTests`，改为 `pnpm test`。真实测试失败仍会阻止推送。

类型检查使用当前工作区文件，覆盖范围由 `tsconfig.json` 的 `include` 决定，不仅检查暂存区。以后将代码迁到 `src/` 时，也要同步更新类型检查范围。

构建、Playwright E2E 和 playground 测试暂不放入钩子：它们需要对应配置、入口或浏览器环境，而且执行较慢。相关设施就绪后手动运行或放入 CI。

### 安装与启用

首次克隆后安装依赖，`prepare` 会配置钩子。已有依赖时可单独执行 `pnpm prepare`。

```powershell
pnpm install
pnpm prepare
git config --get core.hooksPath
```

最后一条命令应输出 `.husky/_`。

需要提交 `.husky/pre-commit`、`.husky/commit-msg`、`.husky/pre-push` 和 `.gitattributes`。不要提交自动生成的 `.husky/_/`。Windows 下 `.gitattributes` 为钩子指定 LF 换行，避免 Shell 脚本被 CRLF 换行影响。

### 提交信息格式

```text
feat(popup): 添加设置面板
fix: 修复页面消息处理
docs: 更新开发说明
refactor(store)!: 调整状态结构
```

`scope` 和表示不兼容变更的 `!` 可选，描述可以使用中文。支持的类型为 `feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`。

这是不额外安装依赖的首行格式检查，不是完整的 commitlint 规则集。Git 生成的 merge、revert 和 autosquash 消息允许通过，避免干扰合并、回退和整理历史。

### 如何使用

正常开发时无需手动执行钩子：

```powershell
pnpm compile
pnpm test --passWithNoTests
git add .
git commit -m "feat(popup): 添加设置面板"
git push
```

前两条用于主动检查，`git commit` 和 `git push` 仍会自动运行对应钩子。任何检查失败，都先修复终端提示的问题，再重试 Git 操作。

可以直接验证钩子，不创建提交，也不连接 GitHub：

```powershell
git hook run pre-commit
git hook run pre-push
```

### 后续扩展

- 当前未配置 ESLint、Prettier 或 lint-staged，不要直接向钩子添加不存在的 `pnpm lint` 命令。
- 确定格式规范并完成 ESLint/Prettier 配置后，再用 lint-staged 只处理暂存文件；`tsc --noEmit` 仍应检查整个项目。
- 增加单元测试后，移除推送钩子的空测试集豁免。
- 团队协作时在 CI 重复运行类型检查和测试，并配置合并保护。本地钩子可以被跳过，不能替代 CI。

### 忽略文件说明

`.gitignore` 已补充 Husky 生成目录、覆盖率与检查缓存、Playwright 测试结果及报告、`playwright/.auth/` 登录状态目录（包括子项目）。真实 `.env` 文件仍被忽略，示例环境变量文件和 `pnpm-lock.yaml` 保留。

不要把令牌写进环境变量示例文件，也不要把登录状态保存到未忽略的位置。忽略规则不会自动移除已经被 Git 跟踪的文件。

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
4. 提交代码（Husky 自动检查类型和提交信息）
5. 推送代码（Husky 自动运行单元测试）

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
A: 运行 `pnpm prepare`，并确认 `git config --get core.hooksPath` 输出 `.husky/_`。如果仅在 IDE 中失败，检查 IDE 是否能找到 Node.js 和 pnpm。修改 PATH 后重启 IDE。

**Q: 推送时提示 No test files found？**
A: 当前允许空测试集，因此会放行；这不表示已有测试通过。添加单元测试后移除 `.husky/pre-push` 中的 `--passWithNoTests`。

**Q: 如何禁用某个 hook？**
A: 删除对应的 `.husky/hook-name` 文件，或在文件中注释掉相关命令

**Q: Zustand 数据丢失？**
A: 检查是否正确配置了 `persist` 中间件，以及 localStorage 是否被清空

**Q: 如何在多个页面间共享 Zustand 状态？**
A: 在浏览器扩展中，popup、content script、background 是隔离的，需要使用 Chrome Storage API 或消息传递
