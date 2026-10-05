# TypeScript baseUrl 和路径别名配置指南

## 📚 背景知识

### baseUrl 的作用
`baseUrl` 告诉 TypeScript 从哪里开始解析模块路径。

```json
// baseUrl: "."
import { something } from 'utils/helper';  // 从项目根目录查找

// baseUrl: "./src"
import { something } from 'utils/helper';  // 从 src 目录查找
```

## 🎯 现代项目的最佳实践

### 方案对比

#### ❌ 旧的做法（不推荐）
```json
{
  "compilerOptions": {
    "baseUrl": "./src",
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

**问题**：
- 绑定到特定目录结构
- 不同项目结构需要修改
- 与构建工具配置不一致

#### ✅ 新的做法（推荐）
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"],      // 相对于项目根目录
      "~/*": ["./*"]       // 备用别名
    }
  }
}
```

**优势**：
- 灵活适应不同目录结构
- 与现代构建工具一致
- 更清晰的导入路径

## 🔧 在你的 WXT 项目中

### 当前配置

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"],
      "~/*": ["./*"]
    },
    "moduleResolution": "bundler"  // 关键！使用现代解析方式
  },
  "include": ["entrypoints", "components", "utils", "assets"]
}
```

### 使用示例

```typescript
// ✅ 使用别名导入（推荐）
import Logo from '@/assets/react.svg';
import { useAppStore } from '@/entrypoints/popup/store';
import Button from '@/components/Button';

// ✅ 相对路径导入（组件内部）
import { helper } from './utils';
import styles from './App.css';

// ❌ 避免深层相对路径
import Logo from '../../../assets/react.svg';
```

## 📦 与构建工具的配合

### WXT 内置支持

WXT 框架**自动**支持以下别名，无需额外配置：

```typescript
// 这些都开箱即用
import '@/styles/global.css';
import Logo from '@/assets/logo.svg';
import { config } from '@/config';
```

### 如果需要自定义别名

在 `wxt.config.ts` 中添加：

```typescript
import { defineConfig } from 'wxt';
import path from 'path';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@components': path.resolve(__dirname, './components'),
        '@utils': path.resolve(__dirname, './utils'),
      },
    },
  }),
});
```

## 🆚 moduleResolution 选项

### bundler（你正在用，推荐）

```json
{
  "moduleResolution": "bundler"
}
```

- ✅ 为现代打包工具设计（Vite、Webpack、Rollup）
- ✅ 支持包导出（package.json exports）
- ✅ 更符合现代 JavaScript 标准
- ✅ TypeScript 4.7+ 推荐

### node / node16 / nodenext（传统方式）

```json
{
  "moduleResolution": "node"
}
```

- 适用于 Node.js 项目
- 不适合前端打包工具

## 📋 完整的推荐配置

### 小型项目（扁平结构）

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    },
    "moduleResolution": "bundler"
  }
}
```

### 大型项目（多层结构）

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"],
      "@components/*": ["./components/*"],
      "@utils/*": ["./utils/*"],
      "@hooks/*": ["./hooks/*"],
      "@types/*": ["./types/*"]
    },
    "moduleResolution": "bundler"
  }
}
```

## 🚨 常见问题

### Q: TypeScript 能识别别名，但 IDE 报错？

**解决方案**：确保 `include` 字段包含所有目录

```json
{
  "include": [
    "entrypoints",
    "components",
    "utils",
    "assets",
    "*.ts"
  ]
}
```

### Q: 导入时没有自动补全？

**解决方案**：重启 TypeScript 服务器
- VS Code: `Ctrl+Shift+P` → "TypeScript: Restart TS Server"
- WebStorm: File → Invalidate Caches

### Q: 构建时找不到模块？

**解决方案**：确保构建工具也配置了相同的别名

```typescript
// vite.config.ts / wxt.config.ts
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
```

## 🎓 总结

### 现代 TypeScript 项目的路径配置原则：

1. ✅ **使用 `moduleResolution: "bundler"`**（而不是 node）
2. ✅ **`baseUrl: "."`** 设为项目根目录
3. ✅ **用别名替代深层相对路径**
4. ✅ **保持 TypeScript 和构建工具配置一致**
5. ✅ **使用 `@/` 作为主要别名**

### 你的项目已经配置好了：

```typescript
// ✅ 可以直接这样导入
import Logo from '@/assets/react.svg';
import { useAppStore } from '@/entrypoints/popup/store';
```

没有 TypeScript 7.0 的说法，但这就是**当前最佳实践**！
