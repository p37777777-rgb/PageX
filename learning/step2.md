# Step 2：存储层与浏览器 API 封装

> 当前目标：在契约层的基础上，建立统一的存储管理和浏览器能力封装，为后续的 Agent Runtime 和 UI 提供稳定的数据持久化和浏览器交互能力。
>
> 本阶段将实现 `shared/utils`、`shared/storage`、`shared/browser` 和 `shared/extension`。

---

## 1. 当前 PageX 状态回顾

### 1.1 Step 1 完成情况

✅ **已完成：**
- `wxt.config.ts` 配置了 `srcDir: 'src'` 和 manifest 权限
- `package.json` 包含所需依赖
- `src/assets/` 包含样式和图标资源
- `src/shims/` 提供浏览器端 Node API 替代
- `src/shared/contracts/` 所有契约文件已创建

⚠️ **待修复：**
- `tsconfig.json` 的 `paths` 配置需要调整为 `"@/*": ["src/*"]`
- `tsconfig.json` 的 `include` 需要包含 `src/**/*`
- `src/shared/utils/` 目录为空，需要补充工具函数

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

本阶段要建立三个核心能力：

| 层次 | 目录 | 职责 |
|------|------|------|
| **通用工具** | `shared/utils/` | ID 生成、文本处理、JSON 安全、Markdown 渲染 |
| **存储管理** | `shared/storage/` | IndexedDB 封装、设置持久化、会话存储、密钥管理 |
| **浏览器能力** | `shared/browser/` | 标签页操作、权限管理、截图、CDP 调试 |
| **扩展运行时** | `shared/extension/` | RPC 客户端、Service Worker 保活、快捷键、Shadow DOM |

完成本阶段后，PageX 将具备：
- ✨ 统一的数据持久化能力
- ✨ 安全的密钥存储机制
- ✨ 跨上下文的 RPC 通信
- ✨ 完整的浏览器 API 封装

---

## 3. 实现顺序与依赖关系

```text
┌─────────────────────────────────────────────┐
│  Step 1 遗留：修复 tsconfig + 实现 utils   │
└─────────────────────┬───────────────────────┘
                      │
                      v
        ┌─────────────────────────┐
        │   shared/storage/       │
        │  - idb.ts              │
        │  - storage.ts          │
        └────────────┬────────────┘
                     │
                     v
        ┌─────────────────────────┐
        │   shared/browser/       │
        │  - tabs.ts             │
        │  - permissions.ts      │
        │  - screenshot.ts       │
        │  - cdp.ts              │
        │  - devtools-log.ts     │
        └────────────┬────────────┘
                     │
                     v
        ┌─────────────────────────┐
        │  shared/extension/      │
        │  - rpc-client.ts       │
        │  - keepalive.ts        │
        │  - hotkey.ts           │
        │  - shadow-portal.ts    │
        │  - theme.ts            │
        │  - panel-position.ts   │
        │  - top-layer.ts        │
        └─────────────────────────┘
```

---

## 4. 第一部分：修复 Step 1 遗留问题

### 4.1 修复 `tsconfig.json`

**问题诊断：**
当前配置的 `"@/*": ["./*"]` 会将 `@/shared/contracts/...` 解析到项目根目录，而不是 `src/` 目录。

**修复方案：**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "~/*": ["src/*"]
    }
  },
  "include": [
    ".wxt/**/*",
    "src/**/*",
    "wxt.config.ts"
  ]
}
```

**关键变更：**
- ✅ `"@/*": ["src/*"]` - 正确指向 src 目录
- ✅ `include` 包含 `"src/**/*"` - 确保 TypeScript 检查所有源文件
- ✅ 包含 `.wxt/**/*` - WXT 生成的类型定义

### 4.2 实现 `shared/utils/utils.ts`

这是整个项目的基础工具库，被所有其他模块依赖。

**文件职责：**
- ID 生成（会话、消息、元素）
- 文本截断和格式化
- 安全的 JSON 序列化
- 异步工具（延迟、重试、超时）
- 字符串处理（转义、清理）

**核心功能清单：**

```typescript
// ID 生成
export function generateId(prefix: string): string
export function generateSessionId(): string
export function generateMessageId(): string
export function generateElementId(): string

// 文本处理
export function truncate(text: string, maxLength: number): string
export function sanitizeForLog(text: string): string
export function escapeHtml(text: string): string

// JSON 安全
export function safeJsonParse<T>(json: string, fallback: T): T
export function safeJsonStringify(obj: any): string

// 异步工具
export function delay(ms: number): Promise<void>
export function timeout<T>(promise: Promise<T>, ms: number): Promise<T>
export function retry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>

// 对象工具
export function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K>
export function omit<T, K extends keyof T>(obj: T, keys: K[]): Omit<T, K>
```

**参考实现要点：**

```typescript
// ID 生成使用时间戳 + 随机数确保唯一性
export function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${timestamp}_${random}`;
}

// 安全 JSON 处理避免循环引用和敏感信息泄露
export function safeJsonStringify(obj: any): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    // 过滤敏感字段
    if (key.toLowerCase().includes('secret') || 
        key.toLowerCase().includes('password') ||
        key.toLowerCase().includes('token')) {
      return '[REDACTED]';
    }
    // 避免循环引用
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  });
}
```

### 4.3 实现 `shared/utils/markdown.ts`

负责 Agent 输出内容的安全渲染。

**文件职责：**
- 使用 `marked` 解析 Markdown
- 使用 `dompurify` 清理 HTML
- 处理代码块高亮
- 处理链接安全

**核心功能：**

```typescript
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export interface MarkdownOptions {
  allowHtml?: boolean;
  sanitize?: boolean;
  breaks?: boolean;
}

export function parseMarkdown(
  markdown: string, 
  options?: MarkdownOptions
): string

export function sanitizeHtml(html: string): string

export function extractCodeBlocks(markdown: string): Array<{
  language: string;
  code: string;
}>
```

**安全要点：**
- ⚠️ 必须使用 `DOMPurify.sanitize()` 清理 HTML
- ⚠️ 限制允许的 HTML 标签和属性
- ⚠️ 外部链接添加 `target="_blank"` 和 `rel="noopener noreferrer"`
- ⚠️ 禁止 `javascript:` 协议链接

---

## 5. 第二部分：存储层实现

### 5.1 `shared/storage/idb.ts` - IndexedDB 封装

IndexedDB 是扩展的主要持久化存储，用于保存会话历史、记忆和大对象。

**数据库结构设计：**

```typescript
// 数据库名称和版本
const DB_NAME = 'pagex-db';
const DB_VERSION = 1;

// Store 名称
export const STORES = {
  SESSIONS: 'sessions',           // 页面会话
  VAULT: 'vault',                 // 域名会话仓库
  MEMORIES: 'memories',           // 页面记忆
  TEACHING: 'teaching',           // 示教记录
  CHECKPOINTS: 'checkpoints',     // Agent 检查点
} as const;
```

**核心 API：**

```typescript
export interface IDBStore {
  get<T>(store: string, key: string): Promise<T | undefined>;
  set<T>(store: string, key: string, value: T): Promise<void>;
  delete(store: string, key: string): Promise<void>;
  list<T>(store: string): Promise<Array<{ key: string; value: T }>>;
  clear(store: string): Promise<void>;
}

export function openDatabase(): Promise<IDBDatabase>
export function getIDBStore(): IDBStore
```

**实现要点：**

1. **初始化数据库：**
```typescript
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (event) => {
      const db = request.result;
      // 创建所有 object stores
      for (const storeName of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      }
    };
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
```

2. **事务封装：**
```typescript
async function get<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDatabase();
  const transaction = db.transaction(store, 'readonly');
  const objectStore = transaction.objectStore(store);
  
  return new Promise((resolve, reject) => {
    const request = objectStore.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
```

3. **测试辅助：**
```typescript
// 仅用于测试环境清空数据
export async function clearAllStoresForTest(): Promise<void> {
  const db = await openDatabase();
  for (const storeName of Object.values(STORES)) {
    await clearStore(db, storeName);
  }
}
```

### 5.2 `shared/storage/storage.ts` - 统一存储管理

这是存储层的核心，统一管理所有持久化数据。

**存储分层设计：**

```typescript
// chrome.storage.local - 持久化配置
export interface LocalStorage {
  settings: Settings;               // 用户设置
  apiKeys?: Record<string, string>; // API 密钥（可选持久化）
  mcpConfig?: McpConfig;            // MCP 配置
}

// chrome.storage.session - 临时会话数据
export interface SessionStorage {
  apiKeys?: Record<string, string>; // API 密钥（临时存储）
  checkpoints: Record<string, Checkpoint>; // Agent 检查点
}

// IndexedDB - 大容量历史数据
// - 通过 idb.ts 访问
```

**核心存储 API：**

```typescript
export class Storage {
  // 设置相关
  async getSettings(): Promise<Settings>
  async setSettings(settings: Partial<Settings>): Promise<void>
  
  // 密钥管理
  async getApiKey(provider: string): Promise<string | undefined>
  async setApiKey(provider: string, key: string, persist: boolean): Promise<void>
  async deleteApiKey(provider: string): Promise<void>
  
  // 会话管理
  async getPageSession(tabId: number): Promise<PageSession | undefined>
  async savePageSession(tabId: number, session: PageSession): Promise<void>
  async deletePageSession(tabId: number): Promise<void>
  
  // 检查点管理
  async saveCheckpoint(sessionId: string, checkpoint: Checkpoint): Promise<void>
  async getCheckpoint(sessionId: string): Promise<Checkpoint | undefined>
  async deleteCheckpoint(sessionId: string): Promise<void>
  
  // Vault（域名历史）
  async getVault(domain: string): Promise<DomainVault | undefined>
  async saveVault(domain: string, vault: DomainVault): Promise<void>
  
  // 迁移和维护
  async migrate(): Promise<void>
  async clearAll(): Promise<void>
}

export const storage = new Storage();
```

**安全考虑：**

1. **密钥存储策略：**
```typescript
async setApiKey(provider: string, key: string, persist: boolean): Promise<void> {
  const storageArea = persist ? chrome.storage.local : chrome.storage.session;
  
  // 密钥不进入日志
  console.log(`Saving API key for ${provider} (persist: ${persist})`);
  
  await storageArea.set({
    [`apiKey_${provider}`]: key
  });
}
```

2. **设置默认值：**
```typescript
async getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get('settings');
  return {
    ...DEFAULT_SETTINGS,
    ...result.settings
  };
}
```

3. **版本迁移：**
```typescript
async migrate(): Promise<void> {
  const version = await this.getStorageVersion();
  
  if (version < 2) {
    // 迁移逻辑
    await this.migrateV1ToV2();
  }
  
  await this.setStorageVersion(CURRENT_VERSION);
}
```

---

## 6. 第三部分：浏览器 API 封装

### 6.1 `shared/browser/tabs.ts` - 标签页管理

封装所有标签页相关操作。

**核心功能：**

```typescript
// 获取当前标签页
export async function getCurrentTab(): Promise<chrome.tabs.Tab | undefined>

// 获取标签页列表
export async function queryTabs(query: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>

// 创建新标签页
export async function createTab(options: {
  url: string;
  active?: boolean;
}): Promise<chrome.tabs.Tab>

// 切换到指定标签页
export async function switchToTab(tabId: number): Promise<void>

// 关闭标签页
export async function closeTab(tabId: number): Promise<void>

// 刷新标签页
export async function reloadTab(tabId: number): Promise<void>

// 导航
export async function navigateTab(tabId: number, url: string): Promise<void>
export async function goBack(tabId: number): Promise<void>
export async function goForward(tabId: number): Promise<void>

// 标签页信息
export async function getTabInfo(tabId: number): Promise<{
  url: string;
  title: string;
  isPrivate: boolean;
  canAccess: boolean;
}>
```

**错误处理：**

```typescript
export async function getCurrentTab(): Promise<chrome.tabs.Tab | undefined> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  } catch (error) {
    console.error('Failed to get current tab:', error);
    return undefined;
  }
}
```

**特殊页面处理：**

```typescript
export function isRestrictedUrl(url: string): boolean {
  if (!url) return true;
  
  const restrictedProtocols = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'data:',
    'file://'
  ];
  
  return restrictedProtocols.some(protocol => url.startsWith(protocol));
}
```

### 6.2 `shared/browser/permissions.ts` - 权限管理

处理扩展权限请求和检查。

**核心 API：**

```typescript
// 检查权限
export async function hasPermission(permission: string): Promise<boolean>
export async function hasOriginPermission(origin: string): Promise<boolean>
export async function hasAllSitesPermission(): Promise<boolean>

// 请求权限
export async function requestPermission(permission: string): Promise<boolean>
export async function requestOriginPermission(origin: string): Promise<boolean>
export async function requestAllSitesPermission(): Promise<boolean>

// 撤销权限
export async function removePermission(permission: string): Promise<boolean>

// 权限状态
export async function getPermissionStatus(): Promise<{
  hasAllSites: boolean;
  hasTabs: boolean;
  hasDebugger: boolean;
  grantedOrigins: string[];
}>
```

**用户友好的权限提示：**

```typescript
export function getPermissionDescription(permission: string): string {
  const descriptions: Record<string, string> = {
    'tabs': '访问标签页信息，用于在多个页面间切换',
    'debugger': '使用 Chrome DevTools Protocol，用于高级页面操作和网络监控',
    'downloads': '下载会话记录和导出内容',
    '<all_urls>': '访问所有网站，让 Agent 可以在任何页面工作'
  };
  
  return descriptions[permission] || permission;
}
```

### 6.3 `shared/browser/screenshot.ts` - 截图功能

提供页面截图能力。

**API 设计：**

```typescript
export interface ScreenshotOptions {
  format?: 'png' | 'jpeg';
  quality?: number;  // 0-100, only for jpeg
}

export interface Screenshot {
  dataUrl: string;
  width: number;
  height: number;
  timestamp: number;
}

// 使用 captureVisibleTab
export async function captureVisibleTab(
  options?: ScreenshotOptions
): Promise<Screenshot>

// 使用 CDP 截取完整页面
export async function captureFullPage(
  tabId: number,
  options?: ScreenshotOptions
): Promise<Screenshot>

// 截取指定区域
export async function captureArea(
  tabId: number,
  area: { x: number; y: number; width: number; height: number },
  options?: ScreenshotOptions
): Promise<Screenshot>
```

**实现示例：**

```typescript
export async function captureVisibleTab(
  options: ScreenshotOptions = {}
): Promise<Screenshot> {
  const format = options.format || 'png';
  const quality = options.quality || 90;
  
  const dataUrl = await chrome.tabs.captureVisibleTab({
    format,
    quality: format === 'jpeg' ? quality : undefined
  });
  
  // 解析图片尺寸
  const { width, height } = await getImageDimensions(dataUrl);
  
  return {
    dataUrl,
    width,
    height,
    timestamp: Date.now()
  };
}
```

### 6.4 `shared/browser/cdp.ts` - Chrome DevTools Protocol

提供高级调试能力。

**核心功能：**

```typescript
// 连接管理
export async function attachDebugger(tabId: number): Promise<void>
export async function detachDebugger(tabId: number): Promise<void>
export function isDebuggerAttached(tabId: number): boolean

// 脚本执行
export async function executeScript(
  tabId: number,
  script: string
): Promise<any>

// 鼠标和键盘模拟
export async function mouseClick(
  tabId: number,
  x: number,
  y: number
): Promise<void>

export async function typeText(
  tabId: number,
  text: string
): Promise<void>

// 网络监控
export async function enableNetworkTracking(tabId: number): Promise<void>
export async function getNetworkLog(tabId: number): Promise<NetworkEvent[]>

// 控制台监听
export async function enableConsoleTracking(tabId: number): Promise<void>
export async function getConsoleLog(tabId: number): Promise<ConsoleEvent[]>
```

**错误处理：**

```typescript
export async function attachDebugger(tabId: number): Promise<void> {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (error: any) {
    if (error.message?.includes('already attached')) {
      console.warn('Debugger already attached to tab', tabId);
      return;
    }
    throw new ExtensionError(
      'DEBUGGER_ATTACH_FAILED',
      `无法连接到标签页 ${tabId}：${error.message}`
    );
  }
}
```

### 6.5 `shared/browser/devtools-log.ts` - DevTools 日志管理

规范化和存储 DevTools 事件。

**数据结构：**

```typescript
export interface NetworkEvent {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  timestamp: number;
  type: 'request' | 'response' | 'error';
}

export interface ConsoleEvent {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  message: string;
  timestamp: number;
  args?: any[];
}

export class DevToolsLog {
  private networkEvents: Map<number, NetworkEvent[]>;
  private consoleEvents: Map<number, ConsoleEvent[]>;
  
  addNetworkEvent(tabId: number, event: NetworkEvent): void
  getNetworkEvents(tabId: number): NetworkEvent[]
  clearNetworkEvents(tabId: number): void
  
  addConsoleEvent(tabId: number, event: ConsoleEvent): void
  getConsoleEvents(tabId: number): ConsoleEvent[]
  clearConsoleEvents(tabId: number): void
  
  clearAll(tabId: number): void
}

export const devToolsLog = new DevToolsLog();
```

---

## 7. 第四部分：扩展运行时基础

### 7.1 `shared/extension/rpc-client.ts` - RPC 客户端

在 content、popup、options 中调用 background RPC 的统一客户端。

**核心 API：**

```typescript
export async function rpc<N extends RpcName>(
  name: N,
  payload: RpcPayload<N>
): Promise<RpcResponse<N>>
```

**使用示例：**

```typescript
// 在 content script 中
import { rpc } from '@/shared/extension/rpc-client';

// 获取设置
const settings = await rpc('settings.get', {});

// 观察页面
const observation = await rpc('dom.observe', { 
  includeHidden: false 
});

// 启动 Agent
await rpc('agent.start', {
  message: '帮我填写这个表单',
  sessionId: generateSessionId()
});
```

**实现要点：**

```typescript
export async function rpc<N extends RpcName>(
  name: N,
  payload: RpcPayload<N>
): Promise<RpcResponse<N>> {
  // 1. 生成请求 ID
  const requestId = generateId('rpc');
  
  // 2. Zod 校验 payload
  const validatedPayload = parseRpcPayload(name, payload);
  
  // 3. 发送到 background
  const response = await chrome.runtime.sendMessage({
    channel: EXTENSION_CHANNEL,
    type: 'rpc',
    requestId,
    name,
    payload: validatedPayload
  });
  
  // 4. 处理错误
  if (response.error) {
    throw deserializeError(response.error);
  }
  
  return response.result;
}
```

**超时和重试：**

```typescript
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT = 30000; // 30s

export async function rpc<N extends RpcName>(
  name: N,
  payload: RpcPayload<N>
): Promise<RpcResponse<N>> {
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await timeout(
        sendRpcRequest(name, payload),
        REQUEST_TIMEOUT
      );
    } catch (error: any) {
      lastError = error;
      
      // 不重试的错误
      if (error.code === 'PERMISSION_DENIED') {
        throw error;
      }
      
      // 延迟后重试
      if (attempt < MAX_RETRIES - 1) {
        await delay(1000 * (attempt + 1));
      }
    }
  }
  
  throw lastError;
}
```

### 7.2 `shared/extension/keepalive.ts` - Service Worker 保活

防止 Service Worker 在 Agent 运行时休眠。

**实现策略：**

```typescript
export class Keepalive {
  private port: chrome.runtime.Port | null = null;
  private keepaliveInterval: number | null = null;
  
  // 启动保活
  start(): void {
    if (this.port) return;
    
    // 方法 1: 保持一个 port 连接
    this.port = chrome.runtime.connect({ name: 'keepalive' });
    
    // 方法 2: 定期发送消息
    this.keepaliveInterval = window.setInterval(() => {
      chrome.runtime.getPlatformInfo(() => {
        // 这个调用会重置 Service Worker 的休眠计时器
      });
    }, 20000); // 每 20 秒
  }
  
  // 停止保活
  stop(): void {
    if (this.port) {
      this.port.disconnect();
      this.port = null;
    }
    
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }
}

export const keepalive = new Keepalive();
```

**使用时机：**

```typescript
// 在 Agent 启动时
await rpc('agent.start', { ... });
keepalive.start();

// 在 Agent 完成或停止时
await rpc('agent.stop', { ... });
keepalive.stop();
```

### 7.3 `shared/extension/hotkey.ts` - 快捷键处理

处理 Alt+P 等快捷键。

**API 设计：**

```typescript
export interface HotkeyEvent {
  key: string;
  alt: boolean;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
}

export function isToggleHotkey(event: KeyboardEvent): boolean
export function shouldIgnoreHotkey(event: KeyboardEvent): boolean
```

**实现：**

```typescript
export function isToggleHotkey(event: KeyboardEvent): boolean {
  // Alt+P (manifest 中配置的快捷键)
  return event.altKey && 
         event.key === 'p' && 
         !event.ctrlKey && 
         !event.shiftKey && 
         !event.metaKey;
}

export function shouldIgnoreHotkey(event: KeyboardEvent): boolean {
  // 在输入框中忽略快捷键
  const target = event.target as HTMLElement;
  const tagName = target.tagName.toLowerCase();
  
  if (tagName === 'input' || tagName === 'textarea') {
    return true;
  }
  
  if (target.isContentEditable) {
    return true;
  }
  
  return false;
}
```

### 7.4 `shared/extension/shadow-portal.ts` - Shadow DOM 挂载

在页面中创建隔离的 Shadow DOM 容器。

**职责：**
- 创建 Shadow DOM 容器
- 注入样式隔离
- 管理 React Portal

**API：**

```typescript
export function createShadowPortal(options: {
  id: string;
  position?: 'top-right' | 'bottom-right';
  zIndex?: number;
}): {
  container: HTMLElement;
  shadow: ShadowRoot;
  destroy: () => void;
}
```

**实现示例：**

```typescript
export function createShadowPortal(options: {
  id: string;
  position = 'top-right';
  zIndex = 2147483647;
}) {
  // 1. 创建容器
  const container = document.createElement('div');
  container.id = options.id;
  container.style.position = 'fixed';
  container.style.zIndex = String(options.zIndex);
  
  // 2. 创建 Shadow Root
  const shadow = container.attachShadow({ mode: 'open' });
  
  // 3. 注入基础样式
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
    }
  `;
  shadow.appendChild(style);
  
  // 4. 插入页面
  document.documentElement.appendChild(container);
  
  return {
    container,
    shadow,
    destroy: () => container.remove()
  };
}
```

### 7.5 其他扩展工具

**`shared/extension/theme.ts`** - 主题管理

```typescript
export type Theme = 'light' | 'dark' | 'system';

export async function getTheme(): Promise<Theme>
export async function setTheme(theme: Theme): Promise<void>
export function syncThemeToDocument(): void
```

**`shared/extension/panel-position.ts`** - 面板位置

```typescript
export interface PanelPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function savePanelPosition(position: PanelPosition): Promise<void>
export async function getPanelPosition(): Promise<PanelPosition | undefined>
```

**`shared/extension/top-layer.ts`** - 顶层 UI

```typescript
export function ensureTopLayer(element: HTMLElement): void
export function setupTopLayerWatcher(): void
```

---

## 8. 本阶段验收清单

### 8.1 配置修复验收

运行编译检查：

```bash
cd D:\000001Coding\pagex\PageX
pnpm compile
```

**预期结果：**
- ✅ 无 `@/shared/...` 路径解析错误
- ✅ `src/**/*` 下的所有文件被 TypeScript 检查
- ✅ 无 WXT 类型错误

### 8.2 Utils 验收

```typescript
// 测试 ID 生成
const sessionId = generateSessionId();
console.assert(sessionId.startsWith('session_'));

// 测试安全 JSON
const obj = { password: '123', data: 'hello' };
const json = safeJsonStringify(obj);
console.assert(!json.includes('123'));
console.assert(json.includes('hello'));
```

### 8.3 Storage 验收

```typescript
// 测试设置存储
await storage.setSettings({ modelProvider: 'anthropic' });
const settings = await storage.getSettings();
console.assert(settings.modelProvider === 'anthropic');

// 测试密钥存储
await storage.setApiKey('anthropic', 'sk-test-123', false);
const key = await storage.getApiKey('anthropic');
console.assert(key === 'sk-test-123');
```

### 8.4 Browser API 验收

```typescript
// 测试标签页
const tab = await getCurrentTab();
console.assert(tab !== undefined);
console.assert(tab.url !== undefined);

// 测试权限
const hasAllSites = await hasAllSitesPermission();
console.log('Has all sites permission:', hasAllSites);

// 测试截图
const screenshot = await captureVisibleTab();
console.assert(screenshot.dataUrl.startsWith('data:image'));
```

### 8.5 RPC 验收

在 content script 中：

```typescript
try {
  // 测试简单 RPC
  const settings = await rpc('settings.get', {});
  console.log('Settings loaded:', settings);
  
  // 测试错误处理
  try {
    await rpc('agent.start', { 
      message: '',  // 应该被 Zod 拒绝
      sessionId: '' 
    });
  } catch (error) {
    console.assert(error.code === 'VALIDATION_ERROR');
  }
  
  console.log('✅ RPC client working');
} catch (error) {
  console.error('❌ RPC client failed:', error);
}
```

### 8.6 完整功能检查

- [ ] tsconfig 路径正确，编译无错误
- [ ] utils.ts 和 markdown.ts 可以被其他模块 import
- [ ] IndexedDB 可以存储和读取数据
- [ ] chrome.storage.local 和 session 工作正常
- [ ] API Key 不出现在日志中
- [ ] 可以获取当前标签页信息
- [ ] 可以请求和检查权限
- [ ] 可以捕获页面截图
- [ ] CDP 可以 attach 和执行脚本
- [ ] RPC 可以从 content 调用 background
- [ ] Service Worker 在任务运行时不休眠
- [ ] Shadow DOM 正确隔离扩展 UI

---

## 9. 下一步计划

完成 Step 2 后，PageX 将具备：
- ✨ 完整的数据持久化能力
- ✨ 安全的设置和密钥管理
- ✨ 统一的浏览器 API 封装
- ✨ 跨上下文的 RPC 通信
- ✨ Service Worker 生命周期管理

**Step 3 将实现：**
- 📄 `features/page/` - 页面观察与 DOM 操作
  - observer.ts - 页面元素扫描
  - actions/ - 点击、输入、滚动等交互
  - source.ts - 页面源码提取
  - search.ts - 页面文本搜索

**Step 4 将实现：**
- 🤖 `features/agent/runtime/` - Agent 核心
  - models.ts - 模型创建
  - prompts.ts - 系统提示词
  - tools/ - 内置工具
  - runtime.ts - Agent 执行循环

继续加油！🚀
