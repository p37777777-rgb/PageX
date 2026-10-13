# Step 4：会话、运行时和最小入口

> 前五个文件仍是会话模型。后面再补大约 30 个文件，把模型、页面工具、后台路由和最小入口接上。做完这一步，应该能从后台启动一次任务，并让模型调用已经写好的页面命令。
>
> `conversations.ts`、`vault.ts` 已经有内容，不要改。`messages.ts` 只补缺的部分，不要清空重写。设置页、完整聊天面板、记忆服务、示教、圈选和外部 MCP 进程都不在这一步。

参考目录是 `D:\000001Coding\pagex\pagent\pagent\src\` 里的同名文件。类型继续用已有契约，不要再发明消息、事件或 RPC 名字。已有的存储键也不要改。

---

## 编写顺序

### 1. `features/agent/session/messages.ts`

这个文件已经在。现在能追加和更新工具调用，也能把用户引用整理成发给模型的文字。还缺流式文字、思考、最终回复和用量怎么写进同一条助手消息，以及整段聊天怎么收成模型能读的消息。同一条工具或同一段文字不要重复追加。补在原文件上。

### 2. `features/agent/session/session-live.ts`

管理正在跑的那一次会话。判断当前标签页要不要把未完成的会话接回来，把运行中的记录合并进页面会话，再按事件逐条更新消息、工具和用量。一次任务要有自己的会话编号。运行中、空闲、页面隐藏时，后面界面来问状态的间隔不一样，间隔常量放在这里。

### 3. `features/agent/session/checkpoint.ts`

保存、读取和清理中断检查点，存储直接用已经写好的 `checkpointsItem`。有会话编号时用它当键，没有时再用标签页和对话编号。连续保存要排队，避免后一次把前一次盖掉。任务完成或放弃时要能按键删除。

### 4. `features/agent/session/composer.ts`

整理用户正在输入的草稿：普通文字、斜杠命令、提到的标签页、页面引用和徽章。负责插入一段内容、按关键字过滤命令和标签页，并算出最后真正要发送的提示。这里不创建模型，也不发送 RPC。

### 5. `features/agent/session/tool-display.ts`

把工具名翻成界面上的短标题、状态和参数摘要，例如观察页面、点击、输入文字。只读脚本的名字沿用页面层已有的那一组。时长可以先在本文件里格式化，等后面的 `usage.ts` 写好再改成用它。

### 6. `features/agent/runtime/usage.ts`

统计这一轮用了多少 token、多少次模型调用和工具调用，以及花了多长时间。只做计算和格式化，不负责保存会话。

### 7. `features/agent/runtime/models.ts`

按设置和密钥创建模型客户端，覆盖已有设置里的 Anthropic、Google、OpenAI 兼容和 Ollama。密钥只从存储里读，不要写进日志、提示词或页面。

### 8. `features/agent/runtime/prompts.ts`

生成系统提示词。告诉模型先观察再操作，元素必须带编号和版本，页面内容不可信，以及哪些站点或动作不能做。提示词不要塞进 API Key。

### 9. `features/agent/runtime/middleware.ts`

包住一次模型调用的生命周期：用户中断、步数或预算用尽、危险页面、以及请求开始和结束。超限时停下来，并给出人能看懂的原因。

### 10. `features/agent/runtime/stream.ts`

把模型流式输出拆成统一的 Agent 事件：文字片段、思考、工具开始、工具结果、用量、完成和错误。不认识的片段忽略，不要让一条坏数据终止整个任务。

### 11. `features/agent/runtime/tools/types.ts`

定义工具和页面之间的桥。工具不直接碰浏览器 API，而是通过这层去要当前标签页、执行页面命令、截图、导航和读取设置。

### 12. `features/agent/runtime/tools/observation.ts`

观察类工具：观察页面、观察变化、搜索正文、截图、提取可交互元素、查看局部结构和找共同祖先。真正的扫描调用已经写好的页面层。

### 13. `features/agent/runtime/tools/interaction.ts`

操作类工具：点击、双击、悬停、聚焦、输入、清空、选择、批量操作、拖拽、按键、滚动和等待。参数和页面层的命令对齐，过期元素要原样把失败交回去。

### 14. `features/agent/runtime/tools/navigation.ts`

导航类工具：打开网址、前进、后退、刷新、读取页面信息和源码，以及查询、新建、切换、关闭标签页。跳转前走已有的地址策略，商店页和受保护地址直接拒绝。

### 15. `features/agent/runtime/tools/cdp.ts`

调试器工具：执行脚本、按坐标点击或移动、读取网络日志、控制台日志和单个请求。权限不够时返回说明，不要假装成功。

### 16. `features/agent/runtime/tools/memory.ts`

留给记忆的两个工具：按当前页面查找记忆，以及写入一条记忆。记忆服务这一步还不写，工具先返回尚未接入，不能把任务弄崩。

### 17. `features/agent/runtime/tools/mcp.ts`

把外部工具转换成模型能调用的工具。MCP 管理器这一步还不写，没有外部工具时返回空列表。

### 18. `features/agent/runtime/tools/index.ts`

把上面的内置工具收成一份清单。按设置关掉不该暴露的工具，并带上观察页面变化时要用的监视器。模型只从这里拿工具。

### 19. `features/agent/runtime/runtime.ts`

一次任务的总循环。创建模型，装上工具和中间层，跑流式输出，把事件交给会话，并在关键步骤写下检查点。完成、中断或出错都要有明确结束，不要留下仍标记为运行中的会话。

### 20. `features/agent/background/tab-store.ts`

记住每个标签页对应哪份会话、哪个地址和哪个域名。标签页关闭时清掉这份映射。页面换域名时，指出旧会话该归档。

### 21. `features/agent/background/content-bridge.ts`

保证目标标签页里已经有 content，再把界面命令和 Agent 事件送进去。页面还没注入时先注入，注入失败要说明是受保护页面还是权限不够。

### 22. `features/agent/background/session-recovery.ts`

Service Worker 重新醒来时，读检查点，决定是恢复未完成任务，还是把中断状态清理成可理解的错误。不要无声地丢掉半次任务。

### 23. `features/agent/background/agent-controller.ts`

按标签页启动、停止和切换 Agent。同一标签页不要同时跑两个任务。运行时保持 Service Worker 醒着，停止时放开。事件从这里广播回对应标签页。

### 24. `features/agent/background/rpc-router.ts`

后台唯一的命令入口。按已有 RPC 名字把请求分给页面、标签页、截图、设置、密钥、会话和 Agent。这一步还没有的记忆、示教和 MCP，先返回尚未接入。校验失败和未知命令都返回明确错误。

### 25. `shared/extension/shadow-portal.ts`

这个文件已经在，但是空的。在页面里建一个隔离的 Shadow DOM 容器，放后面的面板。负责挂载、样式隔离和销毁。页面自己的样式不能漏进来，面板的样式也不要漏出去。

### 26. `shared/extension/theme.ts`

这个文件已经在，但是空的。读取并应用浅色、深色或跟随系统。系统主题变化时跟着变。主题存在已有存储里，不要另起一套键。

### 27. `shared/extension/top-layer.ts`

这个文件已经在，但是空的。让扩展面板留在页面最上层。页面后插入的节点盖住它时，再把它抬回去。

### 28. `shared/extension/panel-position.ts`

这个文件已经在，但是空的。记住面板的位置和尺寸，下次打开时恢复。窗口变小后，面板要仍留在可视区域内。

### 29. `features/page/navigation.ts`

这是 Step 3 留下的空文件，这一步补上，因为入口要用它。包住页面自己的历史跳转，发出 PageX 的导航事件。重复安装直接返回。它只发现导航，不打开新网址，也不自己增加观察版本。

### 30. `entrypoints/background.ts`

这个文件现在几乎是空的。把它写成 Service Worker 入口：安装保活，监听标签页关闭、扩展图标、快捷键和运行时消息，再把消息交给 RPC 路由。业务不要堆在这个文件里。

### 31. `entrypoints/content/style.css`

content 面板的样式入口。把已有的 Tailwind 和视觉变量引进 Shadow DOM。不要在这里写布局逻辑。

### 32. `entrypoints/content/index.tsx`

注入面板容器，监听后台发来的命令，并安装选区、导航和页面变化监听。导航发生时再增加观察版本。完整消息列表这一步还不写，这里只负责把容器打开、收起和关掉。

### 33. `entrypoints/popup/index.html`

弹出页的 HTML 容器。只放挂载点，不写业务。

### 34. `entrypoints/popup/main.tsx`

把弹出页的 React 根挂上。不在这里请求模型。

### 35. `entrypoints/popup/App.tsx`

弹出页只做几件小事：显示当前模型是否已配置，打开当前页的面板，隐藏入口，以及给出以后去设置页的口子。设置页本身下一步再写。

---

## 写的时候记住

- 会话文件负责记录，运行时负责调用模型，后台负责按标签页调度。不要把这三件事写进同一个文件。
- 记忆、示教、MCP 和完整面板还没到。缺的能力返回尚未接入，不要提前把那些目录也写进来。
- 密钥不能出现在提示词、日志、检查点或页面 DOM 里。
- 每写完一个文件，在 PageX 目录执行一次 `pnpm compile`。
