# 凌越航空 · 智慧运行平台（演练场）

独立 Vue + Vite 应用，外观是一套民航运行中台业务系统，实际用于在真实网页里给被测 Agent 布置任务并自动判定完成情况。

组件库为 Element Plus，图标来自 `@element-plus/icons-vue`。

## 启动

在仓库根目录：

```bash
pnpm dev:playground
```

或在本目录：

```bash
pnpm install
pnpm dev
```

默认打开 [http://localhost:5173](http://localhost:5173)。

判定纯函数的单元测试：

```bash
pnpm --dir tests/web-playground test
```

## 任务判定

任务简报（口语指令 + 验收步骤）是阅后即焚的：复制发给 Agent 后关掉即可，避免 Agent 看到答案。判定入口藏在左侧深色导航栏底部的「运行体检」：**执行体检 / 恢复初始**。判定只看页面终态，分条给出 通过 / 未过 / 存疑。不要让 Agent 去点这两个按钮。

脚本入口（当前页）：

```js
window.__aeroProbe.moduleId()
window.__aeroProbe.runChecks()
window.__aeroProbe.resetModule()
```

航线洞察几乎全是口头结论，体检结果会标成存疑。手册中心用标题、标签与正文关键词做启发式检查。

## 模块

- **值勤偏好**（`duty-prefs`）：签派席个人设置中心，隐蔽交互集合，用于检验变化观察工具的覆盖能力。
- **特殊服务申请**（`special-service`）：特殊旅客服务申请单，覆盖输入、选择、日期、开关、评分、滑块与校验提交。
- **航线洞察**（`route-pulse`）：航线经营看板，覆盖多下拉筛选、可搜索选项与 Chart.js 统计图表。
- **手册中心**（`manuals`）：跨多文档信息检索与汇编、结构化简报撰写、富文本编辑与持久化。
- **过站保障**（`turnaround`）：机坪过站保障控制台（16 个航班、3 个停机坪区）。分 5 大页签（保障总览、保障流水线、节点日志、资源配置、登机口与放行），考验跨页签排障与自愈闭环。
- **维修排程**（`mx-board`）：机务维修工单看板（36 张工单、5 条泳道）。包含横向 1600px+ 视口滚动、HTML5 跨列拖拽排序、工时与子任务进度、阻塞依赖抽屉。
- **票款稽核**（`fare-audit`）：直销出票记录（48 笔、每页 6 笔）与渠道结算流水（80 笔）。支持真实跨标签页多窗口调度（`/fare-audit/ledger`）、差额登记与当页批量提交。
- **行李理赔**（`baggage-claims`）：行李理赔仲裁工作台。包含 20 单待办队列、8 轮旅客-客服长会话（申诉附件中隐蔽潜伏 Prompt Injection）、8 节点运输轨迹核验与 1.2s 会员营销遮罩防御。
- **准点实验**（`on-time-lab`）：航班准点多维分析工作台。底座集成 108 条航班执行明细，支持任意深度的递归嵌套 AND/OR 条件树、动态透视矩阵计算、明细抽屉下钻与 CSV 导出。

## 值勤偏好页的隐蔽交互清单

| # | 交互 | 隐藏手法 | 预期检测路径 |
|---|------|----------|--------------|
| 1 | 语言下拉菜单 | `opacity: 0` + `pointer-events: none`，DOM 常驻，class 切换 | `visibility_changed`（opacity 检测） |
| 2 | 外观下拉菜单 | `visibility: hidden`，DOM 常驻 | 展开后 `added` |
| 3 | 时间基准面板 | `max-height: 0` + `overflow: hidden` 折叠 | `visibility_changed`（rect 高度为 0） |
| 4 | 告警通知开关 | checkbox `opacity: 0` 尺寸 0，label 可见 | 快照中不可见 checkbox + `state_changed` |
| 5 | 静默时段面板 | `max-height: 0` 折叠 + `aria-expanded` | `visibility_changed` + 状态变化 |
| 6 | 安全验证结果条 | `opacity: 0` + `translateY(-8px)`，延迟 1.2s 淡入 | `visibility_changed`（含定时器延迟） |
| 7 | 终端「下线」按钮 | 行内按钮 `opacity: 0`，仅 hover 出现 | hover 后可见；下线后 `removed` |
| 8 | 动态口令按钮 | 倒计时期间 `disabled` + 文本每秒变化 | `state_changed` + `text_changed` 流 |
| 9 | 流水检索建议 | `opacity: 0` + `visibility: hidden`，聚焦出现 | 展开后 `added` |
| 10 | 实验特性启用 | 未勾选风险确认时按钮 `disabled` | `state_changed`（disabled → enabled） |
| 11 | 实验特性面板 | `v-show`（`display: none`） | 开启后 `added` |
| 12 | 账号操作流水 | IntersectionObserver 懒加载分页 | 滚动后 `added`（新增条目） |
