# PageX 重写 Pagent：分阶段复现指南

> 目标：以 `D:\000001Coding\pagex\pagent\pagent` 为参考，在 `D:\000001Coding\pagex\PageX` 中逐步复现一个可运行的浏览器 Agent 扩展。
>
> 本文只描述复现路径和文件职责。复现时应把 Pagent 的实现理解后重新写入 PageX，而不是一次性复制整个仓库。

## 1. 先理解 Pagent 的整体架构

Pagent 是一个基于 WXT + React 的浏览器扩展，核心链路如下：

```text
用户在页面中输入任务
        |
        v
content 入口接收 UI 操作
        |
        v
shared/extension/rpc-client.ts
        |
        v
background 入口接收 RPC
        |
        v
features/agent/background/rpc-router.ts
        |
        +--> features/page/              页面 DOM 能力
        +--> shared/browser/             标签页、截图、CDP、权限
        +--> features/agent/runtime/     模型、Agent、工具、流式事件
        +--> features/memory/            页面记忆
        +--> features/mcp/               外部 MCP 工具
        +--> features/teaching/           示教录制
        |
        v
AgentEvent 通过 background 推送给 content
        |
        v
features/agent/ui/ 渲染消息、工具调用和任务状态
```

重写时要抓住四个边界：

| 边界 | 负责内容 |
| --- | --- |
| `entrypoints/` | WXT 装配入口，不承载复杂业务 |
| `shared/` | 类型契约、RPC、存储、浏览器 API 和通用 UI |
| `features/page/` | 在网页上下文中观察和操作 DOM |
| `features/agent/` | Agent 生命周期、模型调用、工具、会话和 UI |

推荐先完成“观察页面标题”这样的最小闭环，再添加截图、记忆、示教、MCP 等扩展能力。

---

## 2. 重写顺序总览

建议按以下 10 个步骤推进。每一步完成后先执行对应的验收，再继续下一步。

| 步骤 | 主题 | 结果 |
| --- | --- | --- |
| 1 | 项目配置和静态资源 | PageX 具备正确的 WXT、TypeScript 和依赖基础 |
| 2 | 共享契约和运行时基础 | 各上下文可以使用同一套类型、错误和 RPC 协议 |
| 3 | 存储和浏览器 API | 设置、密钥、会话和浏览器能力有统一封装 |
| 4 | 页面观察与 DOM 操作 | content 可以观察并操作当前网页 |
| 5 | Agent 会话模型 | 消息、会话、检查点和持久化逻辑可独立运行 |
| 6 | Agent Runtime 和内置工具 | 模型可以调用页面工具并产生流式事件 |
| 7 | Background 调度与 WXT 入口 | background、content、popup、options 形成完整通信链路 |
| 8 | Agent UI 和设置页 | 用户可以配置模型、启动任务、查看结果 |
| 9 | Memory、Teaching、MCP、Canvas | 在最小闭环之上增加高级功能 |
| 10 | 测试和回归验证 | 单元测试、端到端测试和 playground 逐步补齐 |

---

## 3. 步骤一：项目配置和静态资源

### 目标

先让 PageX 和 Pagent 使用一致的源码根目录、别名、构建入口和依赖版本。此时不写业务逻辑。

### 文件清单

| 文件 | 作用 |
| --- | --- |
| `package.json` | 定义 WXT、TypeScript、React、LangChain、Zod、MCP、测试和构建脚本 |
| `pnpm-lock.yaml` | 锁定依赖版本。保留 PageX 自己的锁文件，不直接覆盖 |
| `wxt.config.ts` | 配置 `srcDir`、React 模块、Tailwind、路径别名、manifest、权限和入口行为 |
| `tsconfig.json` | 配置 TypeScript、`@/*` 别名、WXT 生成类型和测试目录 |
| `src/assets/tailwind.css` | 全局 Tailwind 样式入口 |
| `src/assets/beautiful-ui.css` | Pagent 的视觉变量和 Beautiful UI 样式 |
| `src/assets/pagent-bot.svg` | 被源码 import 的 Agent 图标 |
| `src/assets/react.svg` | 脚手架占位资源，可不迁移 |
| `public/icon-16.png` | 扩展 16px 图标 |
| `public/icon-32.png` | 扩展 32px 图标 |
| `public/icon-48.png` | 扩展 48px 图标 |
| `public/icon-96.png` | 扩展 96px 图标 |
| `public/icon-128.png` | 扩展 128px 图标 |
| `public/pagent-bot.svg` | manifest 或静态页面直接引用的图标 |

### 配置重点

Pagent 使用：

```text
srcDir: 'src'
alias @ -> src
outDir: 'dist'
outDirTemplate: '.'
```

PageX 已经创建了 `src/` 目录。复现时要确保：

- `wxt.config.ts` 的 `srcDir` 为 `src`
- `tsconfig.json` 的 `@/*` 指向 `src/*`
- `tsconfig.json` 的 `include` 包含 `src/**/*`
- Tailwind 扫描 `src/**/*.{js,jsx,ts,tsx,html}`
- `node:fs` 和 `node:path` 在浏览器构建中分别映射到 `src/shims/node-fs.ts` 和 `src/shims/node-path.ts`
- manifest 中的图标文件名与 `public/` 中的文件名一致

Pagent 的主要依赖可以按功能理解：

| 依赖 | 用途 |
| --- | --- |
| `wxt`、`@wxt-dev/module-react` | 扩展构建和 React 入口 |
| `react`、`react-dom` | content、popup、options 和 UI |
| `langchain`、`@langchain/*` | Agent、模型和工具调用 |
| `zod` | RPC、工具和设置参数校验 |
| `@modelcontextprotocol/sdk` | MCP 客户端和服务通信 |
| `dompurify`、`marked` | Markdown 渲染和 HTML 安全 |
| `glimm` | 文本或向量记忆相关能力 |
| `motion`、`lucide-react`、`@tabler/icons-react` | UI 动画和图标 |
| `fake-indexeddb`、`happy-dom`、`vitest`、`playwright` | 测试环境 |

### 验收

```powershell
cd D:\000001Coding\pagex\PageX
pnpm compile
pnpm build
```

此时可以没有业务功能，但不能有 `@/...` 路径解析错误或 WXT 配置错误。

---

## 4. 步骤二：共享契约和运行时基础

### 目标

先定义跨 background、content、popup、options 共享的数据结构。所有后续模块都依赖这些契约。

### `src/shared/contracts/`

| 文件 | 作用 |
| --- | --- |
| `agent.ts` | 定义 `AgentEvent`，描述 token、thinking、tool、usage、done、error 等事件 |
| `channel.ts` | 定义扩展消息通道常量，防止不同消息协议互相误处理 |
| `errors.ts` | 统一错误转换、用户可读错误和 RPC 错误 |
| `rpc.ts` | 定义 RPC 名称、Zod payload schema、请求响应类型和 `parseRpcPayload` |
| `policy.ts` | 导航安全、敏感信息脱敏、页面不可信文本隔离等策略 |
| `page.ts` | 页面观察结果、元素动作、脚本名称、来源类型等类型 |
| `session-messages.ts` | 定义聊天消息、工具调用、任务、用量、引用和徽章 |
| `session.ts` | 定义会话、页面会话仓库、域名 Vault、检查点和会话上下文 |
| `settings.ts` | 定义模型服务商、模型、记忆、执行模式、权限和默认设置 |
| `memory.ts` | 定义记忆列表、更新、删除和检索相关的数据结构 |
| `mcp.ts` | 定义 MCP 配置、服务器状态和 MCP 工具元数据 |
| `mcp-host.ts` | 定义外部 MCP Host、端口和连接状态 |
| `teaching.ts` | 定义示教会话、录制动作、草稿流程和已保存命令 |

其中最重要的是 `rpc.ts`。它把下面几层连接起来：

```text
UI 调用 rpc('agent.start', payload)
  -> Zod 校验 payload
  -> background 根据 RpcName 分发
  -> content 或浏览器 API 执行
  -> 返回 RpcResponse
```

复现时建议先只实现这些最小 RPC：

```text
page.info
dom.observe
dom.click
dom.type
settings.get
settings.set
agent.start
agent.stop
session.context
```

### `src/shims/`

| 文件 | 作用 |
| --- | --- |
| `node-fs.ts` | 为浏览器构建提供受限的 `node:fs` 替代实现 |
| `node-path.ts` | 为浏览器构建提供受限的 `node:path` 替代实现 |

这些 shim 只服务于扩展构建。根目录 `mcp/` 在 Node 环境运行，不要把 MCP 的 Node 依赖错误地替换成浏览器 shim。

### `src/shared/utils/`

| 文件 | 作用 |
| --- | --- |
| `utils.ts` | ID 生成、截断、安全 JSON、通用异步和字符串工具 |
| `markdown.ts` | Markdown 解析、渲染和内容安全处理 |

### 验收

- [ ] 可以从任意入口 import `@/shared/contracts/...`
- [ ] RPC payload 能被 Zod 拒绝非法参数
- [ ] `AgentEvent` 和 `RpcResponse` 类型可以被 background 与 UI 共用
- [ ] 不让 `shared/` 依赖具体 React 页面

---

## 5. 步骤三：存储和浏览器 API

### 目标

在实现 Agent 之前，先把浏览器权限、标签页、截图、CDP 和存储封装好。这样业务代码不需要到处直接调用 `browser.*`。

### `src/shared/storage/`

| 文件 | 作用 |
| --- | --- |
| `idb.ts` | 封装 IndexedDB 的 store、读写、删除和测试重置 |
| `storage.ts` | 统一管理设置、API Key、MCP 配置、会话、域名 Vault、tab UI 和迁移 |

`storage.ts` 中要重点理解这些数据范围：

| 数据 | 存储范围 | 用途 |
| --- | --- | --- |
| 设置 | `local` | 跨浏览器会话保存模型和功能配置 |
| API Key | `local` 或 `session` | 根据用户选择保存密钥 |
| tab 会话 | IndexedDB / session | 当前标签页的即时状态 |
| 域名 Vault | IndexedDB / local | 按站点保存聊天历史 |
| checkpoint | local | Service Worker 重启后的任务恢复 |
| panel UI 状态 | tab 范围 | 记录面板是否打开 |

### `src/shared/browser/`

| 文件 | 作用 |
| --- | --- |
| `tabs.ts` | 当前标签页、标签页列表、创建、关闭、切换、前进、后退、刷新和导航 |
| `permissions.ts` | 查询和请求 all sites、tabs、debugger、origin 权限 |
| `screenshot.ts` | 调用 `captureVisibleTab` 或 CDP 截图，并处理 data URL |
| `cdp.ts` | attach/detach debugger、执行脚本、鼠标输入、网络日志、控制台日志和网络请求 |
| `devtools-log.ts` | 规范化 DevTools 网络与控制台事件，提供查询和清理能力 |

### `src/shared/extension/`

| 文件 | 作用 |
| --- | --- |
| `rpc-client.ts` | UI/content 调用 background RPC，处理请求 ID、错误和重试 |
| `keepalive.ts` | 在 Agent 任务运行时保持 Service Worker 活跃 |
| `hotkey.ts` | 定义 Alt+P 等快捷键，并判断页面键盘事件 |
| `top-layer.ts` | 让页面内悬浮 UI 保持在页面顶层 |
| `shadow-portal.ts` | 在 Shadow DOM 中挂载隔离的扩展 UI |
| `theme.ts` | 同步 light、dark、system 主题 |
| `panel-position.ts` | 保存和计算悬浮面板位置 |

### 验收

先不接模型，完成以下检查：

- [ ] 设置能保存和读取
- [ ] API Key 不出现在普通 UI 状态和日志中
- [ ] `rpc-client.ts` 能收到 background 的成功和失败响应
- [ ] 可以获得当前 tab，并处理没有 URL 的特殊页面
- [ ] 权限不足时返回用户可理解的错误

---

## 6. 步骤四：页面观察与 DOM 操作

### 目标

让 content 脚本能够安全、可重复地观察页面，并使用稳定的 `elementId + revision` 操作元素。

### `src/features/page/`

| 文件 | 作用 |
| --- | --- |
| `observer.ts` | 扫描页面可交互元素，生成语义快照、元素 ID、坐标、动作和页面 revision |
| `actions/index.ts` | 汇总所有 DOM action，并作为统一导出入口 |
| `actions/utils.ts` | 元素查找、事件派发、值读取和通用 DOM 辅助 |
| `actions/interactions.ts` | 点击、双击、悬停、聚焦、输入、清空、选择、按键和拖拽 |
| `actions/batch-interact.ts` | 批量执行多个元素交互并返回 before/after/satisfied |
| `actions/scroll.ts` | 页面、容器和目标元素滚动 |
| `actions/wait.ts` | 等待时间、文本、元素或 URL 条件满足 |
| `actions/tree.ts` | 根据 element ID 输出局部 DOM 树 |
| `actions/ancestor.ts` | 查找多个元素的共同祖先 |
| `actions/scripts.ts` | 执行 extract_links、extract_forms、page_stats 等只读脚本 |
| `content-command-handler.ts` | 把 `dom.*`、`page.*` 和 UI 命令分发给实际页面函数 |
| `change-tracker.ts` | 记录 DOM mutation、表单变化、滚动和导航变化 |
| `search.ts` | 搜索页面文本，返回片段、元素 ID 和位置 |
| `source.ts` | 读取实时 DOM、原始 HTML、标题、正文、链接、脚本和样式表 |
| `selection.ts` | 记录用户当前选中的文本 |
| `navigation.ts` | 监听 History API 和浏览器 navigation 事件 |
| `ui-events.ts` | 在 content UI 内分发 open、toggle、collapse、hide 等事件 |

### 页面层的关键设计

`observer.ts` 不直接把 DOM 节点交给 Agent，而是生成：

```text
elementId
revision
tag / role / name
visible / disabled / value
supported actions
box
```

后续操作携带 `elementId` 和 `revision`。页面发生变化时 revision 失效，操作应要求 Agent 重新观测，避免对旧元素误操作。

### 先实现的最小页面能力

1. `page.info`
2. `dom.observe`
3. `dom.click`
4. `dom.type`
5. `dom.scroll`
6. `dom.wait`

`dom.changes.*`、源码读取、Shadow DOM、批量操作和命名脚本可以在基础动作稳定后补充。

### 验收

在普通网页中验证：

- [ ] 能读取标题、URL 和当前选区
- [ ] 能找到按钮、输入框和链接
- [ ] 能点击按钮
- [ ] 能替换输入框内容
- [ ] 页面变化后旧 `revision` 会被拒绝
- [ ] 页面命令错误不会让 content 入口崩溃

---

## 7. 步骤五：Agent 会话模型

### 目标

先把“消息如何保存、会话如何切换、任务如何恢复”写清楚，再把模型接入。

### `src/features/agent/session/`

| 文件 | 作用 |
| --- | --- |
| `messages.ts` | 把 AgentEvent 应用到聊天消息，处理 token、thinking、工具开始、工具结果和 usage |
| `conversations.ts` | 创建页面会话、生成标题、合并 tab store、判断稀疏会话 |
| `session-live.ts` | 管理运行中会话的 revision 和增量状态 |
| `checkpoint.ts` | 保存、读取、清理 Agent 中断检查点 |
| `vault.ts` | 按域名计算会话仓库 key，并在页面会话与域名历史之间转换 |
| `composer.ts` | 组织用户输入、页面上下文、引用、徽章和图片 |
| `tool-display.ts` | 把工具名称转换为 UI 可读的动作标题 |

### `src/shared/contracts/session-messages.ts`

这里的类型会被 session、runtime 和 UI 同时使用：

- `ChatMessage`：用户消息、助手消息和消息部件
- `TaskRow`：工具调用任务及其运行状态
- `TurnUsage`：token、耗时、模型调用次数和工具调用次数
- `UserBadge`：标签页、命令和元素引用
- `UserReference`：页面、命令和元素上下文

### 推荐实现顺序

```text
ChatMessage / TaskRow
  -> createPageStore
  -> applyAgentEventToStore
  -> session.saveStore
  -> checkpoint
  -> UI session reducer
```

先用假事件测试 session：

```text
thinking -> tool-start -> tool-end -> token -> message -> usage -> done
```

### 验收

- [ ] 一次 Agent 任务可以创建唯一 `sessionId`
- [ ] 消息和工具任务能按事件增量更新
- [ ] 同一事件不会重复追加
- [ ] 刷新或 Service Worker 重启后可以找到 checkpoint
- [ ] 会话能按当前 tab 和域名正确保存

---

## 8. 步骤六：Agent Runtime 和内置工具

### 目标

让模型可以选择工具、调用页面能力，并把流式结果转换成 `AgentEvent`。

### `src/features/agent/runtime/`

| 文件 | 作用 |
| --- | --- |
| `models.ts` | 根据 settings 和 secrets 创建 Anthropic、Google、OpenAI 兼容或 Ollama 模型 |
| `prompts.ts` | 生成系统提示词，告诉模型页面观察、工具调用和安全边界 |
| `middleware.ts` | 处理中断、预算、安全、页面不可信内容和请求生命周期 |
| `stream.ts` | 解析 LangChain stream chunk，转换为 token、reasoning、tool 和 usage 事件 |
| `usage.ts` | 计算 turn timing、token 和模型/工具调用统计 |
| `runtime.ts` | 创建 LangChain Agent，注入工具和 middleware，运行任务并持久化 checkpoint |

### `src/features/agent/runtime/tools/`

| 文件 | 作用 |
| --- | --- |
| `types.ts` | 定义 `ToolBridge`，统一提供 content、tabs、navigate、screenshot、CDP 和 settings 能力 |
| `index.ts` | 组装内置工具、变化观测 watch 和禁用工具过滤 |
| `observation.ts` | `observe_page`、`observe_page_changes`、`search_page_text`、截图、交互提取、树查看和共同祖先 |
| `interaction.ts` | 点击、双击、悬停、输入、清空、选择、批量交互、拖拽、按键、滚动和等待 |
| `navigation.ts` | 导航、前进、后退、刷新、页面信息、源码、标签页查询、打开、切换和关闭 |
| `cdp.ts` | CDP 脚本、坐标输入、网络日志、控制台日志和网络请求工具 |
| `memory.ts` | 搜索和写入页面记忆的 Agent 工具 |
| `mcp.ts` | 把外部 MCP 工具转换成 LangChain 工具 |

### 运行链路

`runtime.ts` 的基本流程是：

```text
loadSettings + loadSecrets
  -> createChatModel
  -> createAgentTools
  -> createSafetyMiddleware
  -> createAgent
  -> agent.stream
  -> interpretStreamChunk
  -> applyAgentEventToStore
  -> broadcast to content
```

第一次实现时建议只启用：

```text
observe_page
search_page_text
click_element
type_text
scroll_page
wait_for
page_info
```

等基础任务稳定后，再启用 CDP、Memory、MCP 和复杂页面动作。

### 验收

- [ ] 可以配置一个模型服务商并成功测试连接
- [ ] Agent 能调用 `observe_page`
- [ ] Agent 能执行一次点击或输入
- [ ] UI 能收到 token 和 tool 事件
- [ ] 任务完成时收到 `done`
- [ ] 中断、超时、模型错误时收到 `error`
- [ ] API Key 不进入 prompt、普通日志或页面 DOM

---

## 9. 步骤七：Background 调度与 WXT 入口

### 目标

把浏览器事件、RPC、Agent 运行和 content UI 连接起来。

### `src/features/agent/background/`

| 文件 | 作用 |
| --- | --- |
| `agent-controller.ts` | 按 tab 启动、停止、切换 Agent，维护运行中的控制器和事件广播 |
| `rpc-router.ts` | 根据 `RpcName` 路由页面、模型、会话、设置、记忆、示教和 MCP 命令 |
| `content-bridge.ts` | 确保 content script 存在，并向指定 tab 发送 UI 命令和 Agent 事件 |
| `tab-store.ts` | 管理 tab 到会话 store、URL 和域名的映射 |
| `session-recovery.ts` | Service Worker 重启后恢复未完成任务或清理中断状态 |

### `src/entrypoints/`

| 文件 | 作用 |
| --- | --- |
| `background.ts` | 注册 Service Worker，安装 keepalive，监听 tabs、action、commands 和 runtime message |
| `content/index.tsx` | 注入 Shadow DOM UI，注册 content command listener，安装页面观察、选择和导航监听 |
| `content/style.css` | content 页面 UI 的样式入口 |
| `popup/main.tsx` | 挂载 popup React 应用 |
| `popup/index.html` | popup HTML 容器 |
| `popup/App.tsx` | 显示当前模型、打开页面面板、隐藏入口和进入设置页 |
| `options/main.tsx` | 挂载 options React 应用 |
| `options/index.html` | options HTML 容器 |

### Background RPC 的分类

`rpc-router.ts` 中的命令可以按下面的方式理解：

| 分类 | 示例 |
| --- | --- |
| 页面 | `dom.observe`、`dom.click`、`page.info`、`page.source` |
| 标签页 | `tabs.query`、`tabs.create`、`tabs.switch`、`tabs.close` |
| 截图/CDP | `screenshot.capture`、`cdp.script`、`cdp.network` |
| 设置/密钥 | `settings.get`、`settings.set`、`secrets.set` |
| Agent | `agent.start`、`agent.stop`、`agent.toggle` |
| 会话 | `session.context`、`session.setUi`、`session.saveStore` |
| 历史 | `conversations.list`、`conversations.get` |
| Memory | `memory.list`、`memory.update`、`memory.delete` |
| Teaching | `teaching.start`、`teaching.append`、`teaching.confirm` |
| MCP | `mcp.getState`、`mcp.setConfig`、`mcp.sync` |

### 验收

- [ ] action 点击可以注入或切换 content UI
- [ ] Alt+P 可以打开或收起面板
- [ ] content 发出的 RPC 能被 background 路由
- [ ] background 能把 AgentEvent 发送回正确 tab
- [ ] 标签页关闭时，Agent、tab store 和 UI 状态会清理
- [ ] 页面导航时，会话能归档或切换到正确域名

---

## 10. 步骤八：Agent UI 和设置页

### 目标

在通信和 runtime 稳定后，再实现用户界面。UI 只负责展示状态和发起命令，不直接创建模型或操作 DOM。

### `src/features/agent/ui/`

#### 组件

| 文件 | 作用 |
| --- | --- |
| `components/AgentApp.tsx` | Agent 面板的最外层应用和开关状态 |
| `components/AgentPanel.tsx` | 面板布局、消息区、输入区和侧边内容 |
| `components/AssistantMessage.tsx` | 渲染助手消息、思考和工具调用结果 |
| `components/Composer.tsx` | 用户输入、发送、停止、图片和引用 |
| `components/HistoryDrawer.tsx` | 打开、切换、删除和导出历史会话 |
| `components/MarkdownContent.tsx` | 安全渲染助手 Markdown |
| `components/PageContext.tsx` | 展示当前页面、标签页和引用上下文 |
| `components/PanelHeader.tsx` | 面板标题、状态、关闭和设置入口 |
| `components/TabStrip.tsx` | 在相关标签页或会话之间切换 |
| `message-window.ts` | 计算消息窗口、滚动和可见区域 |

#### Hooks

| 文件 | 作用 |
| --- | --- |
| `hooks/agent-session-reducer.ts` | 把 AgentEvent 归并到 UI 会话状态 |
| `hooks/useAgentEventConsumer.ts` | 监听 runtime 事件并交给 reducer |
| `hooks/useAgentSession.ts` | 管理发送、停止、当前 session 和错误 |
| `hooks/useBackgroundSessionSync.ts` | 同步 background 的 session store |
| `hooks/useConversationActions.ts` | 新建、切换、删除、导出会话 |
| `hooks/usePageContext.ts` | 读取当前页面上下文和用户引用 |
| `hooks/useStickToBottom.ts` | 消息流式增加时保持滚动位置 |

### `src/shared/ui/`

| 路径/文件 | 作用 |
| --- | --- |
| `button.tsx`、`input.tsx`、`label.tsx` | 基础表单和按钮组件 |
| `select.tsx`、`switch.tsx`、`textarea.tsx` | 设置和输入控件 |
| `alert.tsx`、`badge.tsx` | 提示和状态展示 |
| `BotIcon.tsx` | Agent 图标 |
| `beui/button.tsx` | Beautiful UI 风格按钮 |
| `beui/input.tsx` | Beautiful UI 风格输入框 |
| `beui/select.tsx` | Beautiful UI 风格选择器 |
| `beui/switch.tsx` | Beautiful UI 风格开关 |
| `beui/ease.ts` | 动画缓动函数 |
| `beui/animated-badge.tsx` | 动态徽章 |
| `beui/animated-toast-stack.tsx` | 动态 Toast |
| `beui/bouncy-accordion.tsx` | 动画折叠面板 |
| `beautiful-ui/primitives/LoadingState.tsx` | 加载状态 |
| `beautiful-ui/primitives/PromptBar.tsx` | 提示输入条 |
| `beautiful-ui/primitives/ThinkingState.tsx` | Agent 思考状态 |
| `beautiful-ui/primitives/ToolChips.tsx` | 工具调用标签 |

### `src/features/settings/`

| 文件 | 作用 |
| --- | --- |
| `OptionsApp.tsx` | options 页顶层布局和常规/历史导航 |
| `SettingsPanel.tsx` | 模型、执行方式、截图、权限、记忆和主题设置 |
| `ConversationArchive.tsx` | 浏览、筛选、导出和删除聊天历史 |
| `conversation-archive.ts` | 把存储数据转换成历史摘要和导出结构 |
| `MemorySettingsSection.tsx` | 配置记忆服务、Embedding 和 Reranker |
| `model-list.ts` | 在线读取模型列表并合并内置模型目录 |
| `open-options.ts` | 从面板或 popup 打开 options 页 |

### 验收

- [ ] UI 可以展示 `thinking`、`token`、`tool-start`、`tool-end`、`done` 和 `error`
- [ ] 流式输出不会重复追加消息
- [ ] 面板关闭后任务仍可在 background 继续运行
- [ ] options 可以保存模型和权限设置
- [ ] popup 可以控制当前页面显示状态

---

## 11. 步骤九：高级功能

这些功能都依赖前面的 RPC、存储、runtime 和 UI，不建议提前实现。

### 11.1 Canvas

| 文件 | 作用 |
| --- | --- |
| `features/canvas/ElementPicker.tsx` | 在网页上选择元素并回传元素引用 |
| `features/canvas/ScreenAnnotator.tsx` | 截图后进行区域标注或视觉上下文采集 |

依赖：

```text
shared/browser/screenshot.ts
shared/extension/shadow-portal.ts
shared/contracts/session-messages.ts
```

### 11.2 Memory

| 文件 | 作用 |
| --- | --- |
| `features/memory/api.ts` | 调用 Embedding 和 Reranker 服务 |
| `features/memory/retrieval.ts` | 对页面和历史记忆进行检索、排序和截断 |
| `features/memory/service.ts` | 对外提供记忆搜索、写入、更新、删除和连接测试 |
| `features/memory/storage.ts` | 持久化记忆内容和页面关联信息 |

实现顺序：

```text
storage -> api -> retrieval -> service -> runtime/tools/memory.ts -> settings UI
```

### 11.3 Teaching

| 文件 | 作用 |
| --- | --- |
| `features/teaching/storage.ts` | 保存当前示教会话、录制动作和已保存命令 |
| `features/teaching/content/recorder.ts` | 在 content 侧记录点击、输入、导航等用户动作 |
| `features/teaching/background/teaching-controller.ts` | 管理 recording、summarizing、reviewing、confirmed 状态 |
| `features/teaching/background/flow-summarizer.ts` | 把录制动作总结为可复用流程 |
| `features/teaching/ui/useTeachingSession.ts` | UI 侧读取和操作示教状态 |
| `features/teaching/ui/TeachingOrb.tsx` | 示教入口和录制状态 |
| `features/teaching/ui/TeachingCommentPicker.tsx` | 为动作补充说明 |
| `features/teaching/ui/FlowConfirmCard.tsx` | 审核和确认生成的流程 |
| `features/teaching/ui/CommandSavedAlert.tsx` | 告知用户命令已保存 |

示教状态机：

```text
recording -> summarizing -> reviewing -> confirmed
     |             |             |
     +-----------> cancelled <---+
```

### 11.4 MCP

| 文件 | 作用 |
| --- | --- |
| `features/mcp/json-schema-to-zod.ts` | 把 MCP 的 JSON Schema 转换成 Zod schema |
| `features/mcp/serialize.ts` | 序列化 MCP 工具输入输出，隔离不可控内容 |
| `features/mcp/background/host-client.ts` | 与外部 MCP Host 建立连接 |
| `features/mcp/background/host-discover.ts` | 发现可用 MCP Host |
| `features/mcp/background/host-handlers.ts` | 处理 Host 请求和事件 |
| `features/mcp/background/mcp-manager.ts` | 读取配置、连接服务器、同步工具和状态 |
| `features/agent/runtime/tools/mcp.ts` | 将 MCP 工具注册为 Agent 可调用工具 |

根目录 `mcp/` 是独立 Node 程序：

| 文件 | 作用 |
| --- | --- |
| `mcp/index.ts` | MCP 程序入口，启动服务或监听模式 |
| `mcp/server.ts` | 定义 MCP server 和工具 |
| `mcp/listen.ts` | 处理监听、连接和消息循环 |
| `mcp/extension-rpc.ts` | MCP 程序与浏览器扩展之间的 RPC |
| `mcp/usage.ts` | MCP 使用示例或调用帮助 |

不要把根目录 `mcp/` 当作 WXT entrypoint，也不要让浏览器扩展直接依赖 Node 专属 API。

---

## 12. 步骤十：测试和回归验证

### 测试配置和公共初始化

| 文件 | 作用 |
| --- | --- |
| `vitest.config.ts` | Vitest 的别名、环境和测试匹配配置 |
| `playwright.config.ts` | 浏览器扩展端到端测试配置 |
| `tests/setup.ts` | 测试环境初始化、fake IndexedDB 和浏览器 API mock |
| `tests/e2e/extension.spec.ts` | 加载构建后的扩展并验证真实浏览器交互 |
| `tests/e2e/fixtures/static.html` | 提供稳定的表单、按钮、文本和导航测试页面 |

### 单元测试迁移顺序

先迁移底层纯逻辑，再迁移 UI 和集成逻辑：

| 测试文件 | 对应模块 |
| --- | --- |
| `actions.test.ts` | 页面交互 actions |
| `change-tracker.test.ts` | DOM 变化追踪 |
| `observer.test.ts` | 页面观察 |
| `search.test.ts` | 页面文本搜索 |
| `source.test.ts` | 页面源码和资源提取 |
| `selection.test.ts` | 页面选区 |
| `page-navigation.test.ts` | History/navigation 事件 |
| `policy.test.ts` | URL、脱敏和安全策略 |
| `errors.test.ts` | 错误转换 |
| `rpc.test.ts` | RPC 协议和 payload |
| `storage.test.ts` | 存储封装 |
| `checkpoint.test.ts` | Agent 检查点 |
| `conversations.test.ts` | 会话和标题 |
| `messages.test.ts` | 消息事件归并 |
| `session-live.test.ts` | 运行中 session |
| `session-persistence.test.ts` | 会话持久化 |
| `vault.test.ts` | 域名 Vault |
| `models.test.ts` | 模型创建和协议 |
| `model-list.test.ts` | 模型目录和在线模型 |
| `middleware.test.ts` | 中断、预算和安全 middleware |
| `prompts.test.ts` | Agent system prompt |
| `stream.test.ts` | LangChain stream 解析 |
| `usage.test.ts` | 用量和计时 |
| `mcp.test.ts` | MCP 工具转换 |
| `mcp-host.test.ts` | MCP Host |
| `mcp-host-port.test.ts` | MCP Host 端口 |
| `mcp-server.test.ts` | MCP server |
| `memory.test.ts` | Memory 服务 |
| `teaching.test.ts` | Teaching 状态和流程 |
| `keepalive.test.ts` | Service Worker 保活 |
| `hotkey.test.ts` | 快捷键 |
| `top-layer.test.ts` | 页面顶层 UI |
| `panel-position.test.ts` | 面板位置 |
| `tab-retarget-ui.test.ts` | Agent 跨 tab |
| `tool-display.test.ts` | 工具展示名称 |
| `agent-session-reducer.test.ts` | Agent UI reducer |
| `composer.test.ts` | 输入组合和引用 |
| `message-window.test.ts` | 消息窗口 |
| `stick-to-bottom.test.ts` | UI 自动滚动 |
| `markdown.test.ts` | Markdown 安全渲染 |
| `select.test.tsx` | Select 组件 |
| `bot-icon.test.tsx` | BotIcon 组件 |
| `conversation-archive.test.ts` | 会话归档和导出 |

### Playground

Pagent 的 `tests/web-playground/` 是单独的 Vue 测试场景项目，不要在主扩展尚未跑通时迁移。它用于验证复杂网页交互：

```text
tests/web-playground/
├── src/scenes/       # 表单、图表、知识库、看板、DevOps 等场景
├── src/oracle/       # 场景结果判断
├── src/components/   # 场景任务面板和验证面板
└── package.json
```

建议最后迁移：

1. `static.html` 和扩展 e2e
2. 页面 actions 单元测试
3. contracts、storage、runtime 单元测试
4. UI 单元测试
5. web playground 场景

### 验收命令

```powershell
cd D:\000001Coding\pagex\PageX
pnpm compile
pnpm test
pnpm build
pnpm test:e2e
```

---

## 13. 推荐的实际提交顺序

为了便于学习和定位问题，每个阶段完成后单独提交：

```text
1. chore: align PageX WXT and TypeScript configuration
2. feat: add shared contracts and browser extension utilities
3. feat: add storage and browser API adapters
4. feat: add page observer and DOM actions
5. feat: add conversation and checkpoint model
6. feat: add agent runtime and builtin tools
7. feat: connect background, content, popup, and options
8. feat: add agent panel and settings UI
9. feat: add memory, teaching, MCP, and canvas
10. test: migrate unit, e2e, and playground coverage
```

每次提交都应该满足：

- 项目仍然可以 `pnpm compile`
- 新增模块有一个最小验证
- 不把下一阶段的复杂依赖提前混入
- 出错时能根据入口、RPC、runtime、UI 的边界定位

## 14. 最终完成标准

### 目录

- [ ] 所有 WXT 入口位于 `src/entrypoints/`
- [ ] 所有业务模块位于 `src/features/`
- [ ] 跨上下文协议位于 `src/shared/contracts/`
- [ ] 存储和浏览器能力位于 `src/shared/`
- [ ] 图标位于 `public/`
- [ ] Node MCP 程序位于根目录 `mcp/`

### 功能

- [ ] content 能观察页面和执行基础 DOM 操作
- [ ] background 能启动、停止和恢复 Agent
- [ ] Agent 能调用模型和页面工具
- [ ] UI 能展示流式消息、工具状态、错误和用量
- [ ] options 能保存模型、权限、记忆和主题配置
- [ ] 会话能按 tab、页面和域名保存
- [ ] 高级能力失败时不会破坏基础对话

### 验证

```powershell
cd D:\000001Coding\pagex\PageX
pnpm compile
pnpm test
pnpm build
```

完成基础闭环后，再迁移 `tests/web-playground/`，并继续优化 UI 和高级工具。
