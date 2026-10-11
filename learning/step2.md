# Step 2：存储层与浏览器 API 封装

> 当前目标：在契约层的基础上，建立统一的存储管理和浏览器能力封装，为后续的 Agent Runtime 和 UI 提供稳定的数据持久化和浏览器交互能力。

---

## 1. 当前 PageX 状态回顾

### 1.1 Step 1 完成情况

✅ **已完成：**
- `wxt.config.ts` 配置了 `srcDir: 'src'` 和 manifest 权限
- `package.json` 包含所需依赖
- `src/assets/` 包含样式和图标资源
- `src/shims/` 提供浏览器端 Node API 替代
- `src/shared/contracts/` 所有契约文件已创建
- `tsconfig.json` 路径配置已修复

⚠️ **待实现：**
- `src/shared/utils/` 目录为空，需要补充工具函数
- `src/shared/storage/` 目录为空
- `src/shared/browser/` 目录为空
- `src/shared/extension/` 目录为空

### 1.2 本阶段的位置

```text
Step 1: 契约层 (contracts + shims)  ✅
            |
            v
Step 2: 基础设施层 (utils + storage + browser + extension)  ← 当前阶段
            |
            v
Step 3: 页面能力层 (features/page)
            |
            v
Step 4: Agent 核心 (features/agent/runtime + session)
```

---

## 2. 本阶段目标总览

| 层次 | 目录 | 职责 |
|------|------|------|
| **通用工具** | `shared/utils/` | ID 生成、文本处理、JSON 安全、Markdown 渲染 |
| **存储管理** | `shared/storage/` | IndexedDB 封装、设置持久化、会话存储、密钥管理 |
| **浏览器能力** | `shared/browser/` | 标签页操作、权限管理、截图、CDP 调试 |
| **扩展运行时** | `shared/extension/` | RPC 客户端、Service Worker 保活、快捷键、Shadow DOM |

---

## 3. 实现顺序与依赖关系

```text
┌─────────────────────────────────┐
│  第一部分：通用工具 (utils)     │
│  - utils.ts                    │
│  - markdown.ts                 │
└────────────┬────────────────────┘
             │
             v
┌─────────────────────────────────┐
│  第二部分：存储层 (storage)     │
│  - idb.ts                      │
│  - storage.ts                  │
└────────────┬────────────────────┘
             │
             v
┌─────────────────────────────────┐
│  第三部分：浏览器 API (browser) │
│  - tabs.ts                     │
│  - permissions.ts              │
│  - screenshot.ts               │
│  - cdp.ts                      │
│  - devtools-log.ts             │
└────────────┬────────────────────┘
             │
             v
┌─────────────────────────────────┐
│ 第四部分：扩展运行时 (extension)│
│  - rpc-client.ts               │
│  - keepalive.ts                │
│  - hotkey.ts                   │
│  - shadow-portal.ts            │
│  - theme.ts                    │
│  - panel-position.ts           │
│  - top-layer.ts                │
└─────────────────────────────────┘
```

---

## 4. 第一部分：通用工具层

### 4.1 `shared/utils/utils.ts`

**作用：** 整个项目的基础工具库，被所有其他模块依赖。

**主要功能：**
- ID 生成：会话 ID、消息 ID、元素 ID 等唯一标识符
- 文本处理：截断、转义、清理、格式化
- JSON 安全：安全解析和序列化，防止循环引用和敏感信息泄露
- 异步工具：延迟、超时、重试等常用异步操作
- 对象工具：pick、omit 等对象操作

**依赖：** 无外部依赖，纯函数实现

### 4.2 `shared/utils/markdown.ts`

**作用：** 负责 Agent 输出内容的安全渲染。

**主要功能：**
- 使用 `marked` 解析 Markdown
- 使用 `dompurify` 清理 HTML，防止 XSS 攻击
- 处理代码块高亮
- 处理链接安全（添加 target、rel 属性）

**依赖：** `marked`、`dompurify`

---

## 5. 第二部分：存储层

### 5.1 `shared/storage/idb.ts`

**作用：** IndexedDB 的统一封装层。

**主要功能：**
- 数据库初始化和版本管理
- 统一的 get、set、delete、list、clear API
- 定义所有 object store 名称（sessions、vault、memories、teaching、checkpoints）
- 提供测试环境的清空功能

**存储内容：** 大容量历史数据（会话历史、记忆、示教记录、检查点）

**依赖：** 浏览器原生 IndexedDB API

### 5.2 `shared/storage/storage.ts`

**作用：** 统一存储管理，整合 chrome.storage 和 IndexedDB。

**主要功能：**
- 设置管理：读取和保存用户设置
- 密钥管理：API Key 的持久化或临时存储
- 会话管理：页面会话的读写删
- 检查点管理：Agent 中断恢复点
- Vault 管理：域名历史会话
- 版本迁移：处理存储结构升级

**存储分层：**
- `chrome.storage.local` - 持久化配置和密钥
- `chrome.storage.session` - 临时会话数据
- `IndexedDB` - 大容量历史数据

**依赖：** `idb.ts`、contracts 类型

---

## 6. 第三部分：浏览器 API 封装

### 6.1 `shared/browser/tabs.ts`

**作用：** 封装所有标签页相关操作。

**主要功能：**
- 获取当前标签页、查询标签页列表
- 创建、关闭、切换标签页
- 导航：跳转、前进、后退、刷新
- 获取标签页信息：URL、标题、隐私模式
- 判断受限页面（chrome://、edge:// 等）

**依赖：** `chrome.tabs` API

### 6.2 `shared/browser/permissions.ts`

**作用：** 处理扩展权限请求和检查。

**主要功能：**
- 检查权限：tabs、debugger、all_urls、特定 origin
- 请求权限：动态请求用户授权
- 撤销权限：移除不需要的权限
- 获取权限状态：当前已授权的权限列表
- 提供用户友好的权限描述文本

**依赖：** `chrome.permissions` API

### 6.3 `shared/browser/screenshot.ts`

**作用：** 提供页面截图能力。

**主要功能：**
- 捕获可见区域：使用 `captureVisibleTab`
- 捕获完整页面：使用 CDP 截取整个页面
- 捕获指定区域：截取特定坐标和尺寸
- 支持 PNG 和 JPEG 格式
- 返回 data URL 和图片尺寸

**依赖：** `chrome.tabs` API、CDP

### 6.4 `shared/browser/cdp.ts`

**作用：** Chrome DevTools Protocol 封装，提供高级调试能力。

**主要功能：**
- 连接管理：attach/detach debugger
- 脚本执行：在页面上下文执行 JavaScript
- 鼠标和键盘模拟：坐标点击、文本输入
- 网络监控：启用和获取网络日志
- 控制台监听：启用和获取控制台输出

**依赖：** `chrome.debugger` API

### 6.5 `shared/browser/devtools-log.ts`

**作用：** 规范化和存储 DevTools 事件。

**主要功能：**
- 定义网络事件结构（request、response、error）
- 定义控制台事件结构（log、warn、error、info、debug）
- 按 tabId 管理事件列表
- 提供添加、获取、清空事件的 API

**依赖：** CDP 事件数据

---

## 7. 第四部分：扩展运行时基础

### 7.1 `shared/extension/rpc-client.ts`

**作用：** 在 content、popup、options 中调用 background RPC 的统一客户端。

**主要功能：**
- 提供统一的 `rpc(name, payload)` 函数
- 自动生成请求 ID
- 使用 Zod 校验 payload
- 处理响应错误和反序列化
- 支持超时和重试机制

**使用场景：** UI/content 调用 background 的所有命令

**依赖：** `contracts/rpc.ts`、`chrome.runtime.sendMessage`

### 7.2 `shared/extension/keepalive.ts`

**作用：** 防止 Service Worker 在 Agent 运行时休眠。

**主要功能：**
- 启动保活：创建持久 port 连接
- 定期心跳：每 20 秒发送一次消息
- 停止保活：任务完成后释放连接

**使用时机：** Agent 启动时开启，Agent 停止时关闭

**依赖：** `chrome.runtime` API

### 7.3 `shared/extension/hotkey.ts`

**作用：** 处理 Alt+P 等快捷键。

**主要功能：**
- 判断是否为切换快捷键（Alt+P）
- 判断是否应忽略快捷键（输入框中）
- 提供快捷键事件结构

**依赖：** 键盘事件监听

### 7.4 `shared/extension/shadow-portal.ts`

**作用：** 在页面中创建隔离的 Shadow DOM 容器。

**主要功能：**
- 创建 Shadow DOM 容器
- 注入样式隔离
- 设置位置和 z-index
- 提供销毁方法

**使用场景：** content 脚本中挂载 React UI

**依赖：** 浏览器原生 Shadow DOM API

### 7.5 `shared/extension/theme.ts`

**作用：** 主题管理。

**主要功能：**
- 获取和设置主题（light、dark、system）
- 同步主题到 document
- 监听系统主题变化

**依赖：** `chrome.storage` API

### 7.6 `shared/extension/panel-position.ts`

**作用：** 记忆面板位置。

**主要功能：**
- 保存面板位置和尺寸
- 恢复面板位置
- 处理窗口大小变化

**依赖：** `chrome.storage` API

### 7.7 `shared/extension/top-layer.ts`

**作用：** 确保扩展 UI 始终在页面顶层。

**主要功能：**
- 设置元素为顶层
- 监听页面 DOM 变化
- 自动调整 z-index

**依赖：** MutationObserver

---

## 8. 本阶段验收清单

### 8.1 编译检查

```bash
cd D:\000001Coding\pagex\PageX
pnpm compile
```

**预期：** 无路径解析错误，无类型错误

### 8.2 功能检查

**Utils 层：**
- [ ] ID 生成函数可用
- [ ] 安全 JSON 不泄露敏感信息
- [ ] Markdown 渲染安全

**Storage 层：**
- [ ] 设置可以保存和读取
- [ ] API Key 不出现在日志中
- [ ] IndexedDB 可以存储和读取数据

**Browser 层：**
- [ ] 可以获取当前标签页信息
- [ ] 可以请求和检查权限
- [ ] 可以捕获页面截图
- [ ] CDP 可以 attach 和执行脚本

**Extension 层：**
- [ ] RPC 可以从 content 调用 background
- [ ] Service Worker 在任务运行时不休眠
- [ ] Shadow DOM 正确隔离扩展 UI
- [ ] 快捷键可以正确识别

---

## 9. 实现建议

### 9.1 实现顺序

按照依赖关系，建议按以下顺序实现：

1. **先实现 utils** - 其他模块都会用到
2. **再实现 storage** - browser 和 extension 需要存储
3. **然后实现 browser** - extension 会用到 browser API
4. **最后实现 extension** - 依赖前面所有层

### 9.2 测试策略

- 每完成一个文件，立即在 background 或 content 中简单测试
- 不要等所有文件都完成才测试
- 优先测试核心功能（RPC、存储、标签页）

### 9.3 参考 Pagent

在实现每个文件时，参考 `D:\000001Coding\pagex\pagent\pagent\src\shared\` 对应文件：
- 理解文件的职责和边界
- 学习错误处理方式
- 学习类型定义
- 重新实现，不要直接复制

---

## 10. 下一步计划

完成 Step 2 后，PageX 将具备：
- ✨ 完整的数据持久化能力
- ✨ 安全的设置和密钥管理
- ✨ 统一的浏览器 API 封装
- ✨ 跨上下文的 RPC 通信

**Step 3 将实现：**
- 📄 `features/page/observer.ts` - 页面元素扫描
- 📄 `features/page/actions/` - DOM 交互操作
- 📄 `features/page/source.ts` - 页面源码提取
- 📄 `features/page/search.ts` - 页面文本搜索

继续加油！🚀
