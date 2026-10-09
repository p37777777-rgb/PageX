# Step 1：重写项目基础层

> 当前目标：先把 PageX 从“WXT 脚手架”整理成可以承载 Pagent 业务的基础项目。
>
> 本阶段只处理配置、静态资源、运行时兼容层和共享契约。暂时不要实现 Agent UI、页面操作、模型调用或 MCP。

## 1. 当前 PageX 状态

当前目录已经创建了目标结构：

```text
PageX/
├── entrypoints/                 # 现有脚手架入口
├── public/
├── learning/
├── mcp/                         # 空目录
└── src/
    ├── assets/                  # 空目录
    ├── entrypoints/             # 空目录
    ├── features/                # 空目录
    ├── shared/                  # 空目录
    └── shims/                   # 空目录
```

当前配置存在三个需要优先解决的问题：

1. `wxt.config.ts` 已设置 `srcDir: 'src'`，但业务入口还在根目录 `entrypoints/`。
2. `tsconfig.json` 的 `@/*` 和 `~/*` 仍然指向项目根目录，不符合 Pagent 的 `src/` 结构。
3. PageX 的依赖已经包含 LangChain、React、Zod、Markdown 和记忆相关依赖，但还缺少部分 Pagent 的 UI、MCP 和测试依赖。

因此，本阶段的原则是：

```text
先统一配置
  -> 再迁移共享类型
  -> 再迁移共享工具
  -> 最后通过 TypeScript 编译
```

## 2. 本阶段要重写的文件总表

下面的文件是当前阶段的目标清单。文件内容应参考对应的 Pagent 文件，理解后重新写入 PageX。

### 2.1 项目根目录配置

| PageX 目标文件 | Pagent 参考文件 | 作用 |
| --- | --- | --- |
| `package.json` | `pagent/pagent/package.json` | 合并 Pagent 需要的依赖和脚本，保留 PageX 项目名称及已有配置 |
| `wxt.config.ts` | `pagent/pagent/wxt.config.ts` | 对齐 `srcDir`、输出目录、React 模块、别名、manifest、权限、图标和快捷键 |
| `tsconfig.json` | `pagent/pagent/tsconfig.json` | 对齐 WXT 类型、`@/*` 路径、`include` 和浏览器构建类型 |
| `tailwind.config.js` | Pagent 的 Tailwind 配置及 `src/assets/tailwind.css` | 确保 Tailwind 扫描 `src/` 下的 React 和 TypeScript 文件 |

#### 这些配置文件现在要解决什么

`wxt.config.ts`：

- 保持 `srcDir: 'src'`
- 保持 `@` 指向 `src`
- 增加 Pagent 使用的 manifest 权限和 optional host permissions
- 配置 `public/icon-16.png` 等图标路径
- 配置 `options_ui`
- 配置 `Alt+P` 快捷键
- 为浏览器构建提供 `node:fs` 和 `node:path` shim

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": [
    ".wxt/**/*",
    "src/**/*",
    "wxt.config.ts"
  ]
}
```

实际配置可以保留 PageX 原有选项，但必须确保 `@/shared/...`、`@/features/...` 能解析到 `src/`。

`package.json`：

需要重点对照以下缺失项：

| 类别 | 依赖或脚本 |
| --- | --- |
| MCP | `@modelcontextprotocol/sdk` |
| UI | `@radix-ui/*`、`@tabler/icons-react`、`lucide-react` |
| 样式工具 | `class-variance-authority`、`clsx`、`tailwind-merge` |
| 动画和 UI | `motion`、`shadow-plugin` |
| 测试 | `@playwright/test`、`fake-indexeddb`、`happy-dom`、`vitest` |
| 脚本 | `mcp`、`test`、`test:watch`、`test:e2e` |

不要直接复制 Pagent 的 `pnpm-lock.yaml`。依赖调整后由 PageX 自己重新生成锁文件。

### 2.2 静态资源和全局样式

| PageX 目标文件 | Pagent 参考文件 | 作用 |
| --- | --- | --- |
| `src/assets/tailwind.css` | `src/assets/tailwind.css` | 引入 Tailwind，并定义扩展 UI 使用的全局样式入口 |
| `src/assets/beautiful-ui.css` | `src/assets/beautiful-ui.css` | 定义 Pagent 的色彩、间距、阴影和 Beautiful UI 视觉变量 |
| `src/assets/pagent-bot.svg` | `src/assets/pagent-bot.svg` | 被 React UI import 的 Agent 图标 |
| `public/pagent-bot.svg` | `public/pagent-bot.svg` | 可被 manifest 或静态 HTML 直接访问的 Agent 图标 |
| `public/icon-16.png` | `public/icon-16.png` | 扩展 16px 图标 |
| `public/icon-32.png` | `public/icon-32.png` | 扩展 32px 图标 |
| `public/icon-48.png` | `public/icon-48.png` | 扩展 48px 图标 |
| `public/icon-96.png` | `public/icon-96.png` | 扩展 96px 图标 |
| `public/icon-128.png` | `public/icon-128.png` | 扩展 128px 图标 |

PageX 当前图标在 `public/icon/16.png`、`public/icon/32.png` 等子目录中，而 Pagent 的 manifest 使用的是：

```text
public/icon-16.png
public/icon-32.png
public/icon-48.png
public/icon-96.png
public/icon-128.png
```

本阶段需要统一文件路径和 manifest 引用。不要同时保留两套不同的图标命名规则。

### 2.3 浏览器构建 shim

| PageX 目标文件 | Pagent 参考文件 | 作用 |
| --- | --- | --- |
| `src/shims/node-fs.ts` | `src/shims/node-fs.ts` | 为扩展端代码提供受限的 `node:fs` 替代实现 |
| `src/shims/node-path.ts` | `src/shims/node-path.ts` | 为扩展端代码提供受限的 `node:path` 替代实现 |

这些文件只用于浏览器扩展构建。根目录 `mcp/` 后续运行在 Node 环境，不要让 MCP 代码依赖这些 shim。

### 2.4 共享类型契约

先在 `src/shared/contracts/` 中重写下面这些文件。它们是后续 background、content、Agent Runtime 和 UI 的共同语言。

| PageX 目标文件 | 作用 |
| --- | --- |
| `src/shared/contracts/channel.ts` | 定义 runtime message 使用的通道常量，避免不同扩展消息互相处理 |
| `src/shared/contracts/errors.ts` | 统一错误转换、错误代码和用户可读错误信息 |
| `src/shared/contracts/agent.ts` | 定义 `AgentEvent`，包括 token、thinking、tool、usage、done 和 error |
| `src/shared/contracts/session-messages.ts` | 定义聊天消息、工具调用、任务行、用量、徽章和引用 |
| `src/shared/contracts/session.ts` | 定义会话、页面会话仓库、域名 Vault、checkpoint 和 session context |
| `src/shared/contracts/settings.ts` | 定义模型服务商、模型、执行模式、记忆、权限和默认设置 |
| `src/shared/contracts/page.ts` | 定义页面观察结果、元素动作、脚本名称、源码类型和页面引用 |
| `src/shared/contracts/policy.ts` | 定义 URL 安全、敏感信息脱敏和不可信页面文本隔离策略 |
| `src/shared/contracts/memory.ts` | 定义记忆查询、更新、删除和服务返回值 |
| `src/shared/contracts/mcp.ts` | 定义 MCP 配置、服务器、工具和连接状态 |
| `src/shared/contracts/mcp-host.ts` | 定义 MCP Host、端口和扩展连接状态 |
| `src/shared/contracts/teaching.ts` | 定义示教会话、录制动作、流程草稿和已保存命令 |
| `src/shared/contracts/rpc.ts` | 定义全部 RPC 名称、Zod payload schema、请求响应类型和解析函数 |

#### 重点文件：`src/shared/contracts/rpc.ts`

`rpc.ts` 是本阶段最重要的文件。它应该集中描述所有跨上下文命令，例如：

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

每个 RPC 至少需要明确：

- 命令名称
- payload 的 Zod schema
- 请求类型
- 响应类型
- 发送方和处理方

不要在 UI、content 或 background 中分别手写同一个 payload 的不同类型。

### 2.5 共享工具

| PageX 目标文件 | 作用 |
| --- | --- |
| `src/shared/utils/utils.ts` | 生成 ID、截断文本、安全序列化 JSON、通用异步辅助和字符串处理 |
| `src/shared/utils/markdown.ts` | 处理 Markdown 解析、清理和安全渲染 |

共享工具应保持无 UI、无具体业务依赖，方便后续在 background、content 和测试中复用。

## 3. 本阶段暂时不要重写的文件

虽然 PageX 已经创建了这些空目录，但本阶段暂时不要实现下面的文件：

```text
src/entrypoints/
src/features/
src/shared/browser/
src/shared/extension/
src/shared/storage/
mcp/
```

原因：

| 目录 | 暂缓原因 |
| --- | --- |
| `src/entrypoints/` | 需要等契约和 RPC 基础稳定后再装配入口 |
| `src/features/page/` | 页面操作依赖 `shared/contracts/page.ts` 和 RPC 协议 |
| `src/features/agent/` | Agent Runtime 依赖 session、settings、page 和 browser 契约 |
| `src/shared/browser/` | 浏览器 API 封装应建立在已确定的 RPC 和权限模型之上 |
| `src/shared/extension/` | RPC client、keepalive 和 Shadow DOM 入口要等消息协议稳定 |
| `src/shared/storage/` | 存储结构依赖 settings、session、memory 和 mcp 类型 |
| `mcp/` | MCP 是高级功能，先完成最小 Agent 闭环 |

这不是说这些目录不重要，而是为了避免在契约变化时重复返工。

## 4. 本阶段的编写顺序

按以下顺序创建或重写文件：

### 4.1 先处理根配置

```text
package.json
wxt.config.ts
tsconfig.json
tailwind.config.js
```

### 4.2 再处理资源和 shim

```text
src/assets/tailwind.css
src/assets/beautiful-ui.css
src/assets/pagent-bot.svg
src/shims/node-fs.ts
src/shims/node-path.ts
public/icon-*.png
public/pagent-bot.svg
```

### 4.3 再处理基础类型

```text
src/shared/contracts/channel.ts
src/shared/contracts/errors.ts
src/shared/contracts/agent.ts
src/shared/contracts/session-messages.ts
src/shared/contracts/session.ts
src/shared/contracts/settings.ts
src/shared/contracts/page.ts
src/shared/contracts/policy.ts
src/shared/contracts/memory.ts
src/shared/contracts/mcp.ts
src/shared/contracts/mcp-host.ts
src/shared/contracts/teaching.ts
src/shared/contracts/rpc.ts
```

### 4.4 最后处理通用工具

```text
src/shared/utils/utils.ts
src/shared/utils/markdown.ts
```

## 5. 本阶段的依赖关系

```text
package.json / wxt.config.ts / tsconfig.json
                    |
                    v
          assets + browser shims
                    |
                    v
          contracts/channel + errors
                    |
                    v
 session-messages + settings + page + policy
                    |
                    v
         memory + mcp + teaching
                    |
                    v
                 rpc.ts
                    |
                    v
              shared/utils
```

`rpc.ts` 要放在契约文件基本完成之后编写，因为它会引用 settings、page、memory 和 mcp 中的 schema。

## 6. 本阶段验收清单

### 配置

- [ ] `wxt.config.ts` 使用 `srcDir: 'src'`
- [ ] `wxt.config.ts` 的 `@` alias 指向 `src`
- [ ] `tsconfig.json` 的 `@/*` 指向 `src/*`
- [ ] `tsconfig.json` 的 `include` 包含 `src/**/*`
- [ ] Tailwind 扫描 `src/`
- [ ] manifest 图标路径和 `public/` 文件名一致

### 契约

- [ ] `AgentEvent` 可以被 background 和 UI 共用
- [ ] session 类型不依赖 React
- [ ] page 类型不依赖浏览器入口
- [ ] RPC payload 全部使用集中定义的 schema
- [ ] 错误类型可以在 runtime message 中序列化

### 编译

在 PageX 目录执行：

```powershell
cd D:\000001Coding\pagex\PageX
pnpm compile
```

本阶段允许还没有可运行的 Agent，但不应出现以下问题：

- `@/shared/...` 无法解析
- `@/features/...` 无法解析
- `src/` 未被 TypeScript 检查
- WXT 无法读取 `srcDir`
- manifest 图标不存在

## 7. 完成本阶段后再进入 Step 2

Step 1 完成后，PageX 应具备：

```text
正确的 src/ 源码布局
正确的 WXT 和 TypeScript alias
统一的 Agent / Session / Page / Settings / RPC 契约
浏览器端 node shim
可被后续模块复用的通用工具
```

下一阶段再重写：

```text
src/shared/storage/
src/shared/browser/
src/shared/extension/
```

然后进入页面 DOM 能力和 Agent Runtime。
