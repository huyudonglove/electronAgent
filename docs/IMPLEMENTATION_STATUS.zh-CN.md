# 实现状态

## 2026-05-04 初始骨架

已完成第一版 Electron Agent 工作台工程骨架。

### 已实现

- 创建 pnpm monorepo。
- 创建 `apps/desktop` Electron + React 应用。
- 使用 React Flow/xyflow 搭建节点式编排画布。
- 创建 `packages/shared` 共享类型包。
- 创建 `packages/core` Agent Core 包。
- 定义初始角色：项目、产品、技术、开发、测试。
- 定义核心对象雏形：Role、AgentNode、Workflow、WorkflowRun、NodeRun、PermissionPolicy。
- 实现轻量 DAG 工作流执行器：
  - 支持节点依赖。
  - 支持无依赖节点并行执行。
  - 支持 Merge 等待多个上游节点完成。
  - 支持节点运行记录。
- Electron 使用 preload + IPC 暴露受控 API。
- Renderer 不直接启用 Node.js 能力。
- GUI 初步包含：
  - 左侧角色库。
  - 中间编排画布。
  - 右侧项目输入。
  - 运行按钮。
  - 节点运行记录。

### 验证结果

- `corepack pnpm install` 成功。
- 已通过 `corepack pnpm build`。
- Electron dev 启动链路曾因 pnpm 默认阻止 `electron` 和 `esbuild` build scripts 失败。
- 执行 `corepack pnpm approve-builds --all` 后，Electron/esbuild 安装脚本完成。
- 再次启动 dev 命令未出现编译错误，并保持运行直到超时，说明 Electron 启动链路可用。

### 当前限制

- 目前 Agent 执行是模拟产出，还没有接真实模型 Provider。
- 工作流是内置 sample workflow，还不能在 GUI 中编辑保存。
- 节点状态在运行完成后展示，尚未做实时流式状态更新。
- 产出物尚未写入文件或 SQLite。
- 工具调用系统尚未实现真实文件/Shell/Git 操作。

## 2026-05-04 Preload 加载修复

用户运行 Electron 时遇到 `Unable to load preload script: ...\dist-electron\preload.mjs`。

原因：

- Vite 构建出的 preload 内容是 CommonJS 风格，内部包含 `require("electron")`。
- 产物扩展名是 `.mjs`，Electron 会按 ESM 方式加载，导致 preload 加载失败。

修复：

- 将 Electron 主进程中的 preload 路径改为 `preload.cjs`。
- 调整 Vite preload 构建配置，明确输出 `preload.cjs` 且格式为 `cjs`。
- 删除旧的 `preload.mjs` 残留产物。
- 桌面应用 build 脚本增加 `vite build --emptyOutDir`，避免旧产物残留造成误判。

验证：

- `corepack pnpm build` 成功生成 `dist-electron/main.js` 和 `dist-electron/preload.cjs`。
- 重新运行 dev 命令未立即报 preload 加载错误，并保持运行直到超时。

## 2026-05-04 Chatbot UI 层

用户要求先完成 Chatbot 的 UI 层，暂不接真实模型。

已完成：

- 右侧面板改为 `Chat` / `Run` 双 Tab。
- 新增 `ChatPanel` 组件。
- Chat Panel 包含：
  - 会话消息列表。
  - Provider/模型选择 UI。
  - Provider 状态标记。
  - 快捷动作：生成流程草案、运行当前流程、记录到项目记忆。
  - 输入框和发送按钮。
  - 本地 UI mock 消息交互。
- Run 面板保留原有项目输入、错误提示和节点运行记录。

当前限制：

- Chatbot 已接入 Core ChatService 和 Mock Provider，但尚未接入真实模型 Provider。
- 快捷动作只填充输入提示，不触发真实工作流或记忆写入。

## 2026-05-04 ChatService 与 Mock Provider

已完成 Chatbot 从 UI 到 Core 的基础链路。

新增：

- 共享类型：
  - `ChatMessage`
  - `ChatSession`
  - `ChatRequest`
  - `ChatResponse`
  - `ModelProfile`
  - `ProviderCapability`
- Core：
  - `ChatService`
  - `ModelProvider` 抽象
  - `Mock Provider`
  - 模型配置列表
- Electron：
  - `getInitialState` 返回模型配置。
  - 新增 `sendChatMessage` IPC。
- Renderer：
  - ChatPanel 通过 `window.workbench.sendChatMessage` 调用 Core。
  - 发送消息后使用 Core 返回的 session messages 刷新 UI。
  - 支持模型列表来自 Core。

当前限制：

- Chat 会话存在内存中，尚未持久化到本地文件。
- OpenAI-compatible Provider 还未实现真实 HTTP 调用。
- 暂不支持流式输出。
- 快捷动作仍只是填充提示词。

## 2026-05-04 Agent Builder 页面

用户希望单独新增一个页面，用来自己组建 Agent 团队并完成整个项目开发。

已完成：

- 新增 `AgentBuilderPage`。
- 左侧导航新增“组建团队”入口。
- 顶部标题根据页面切换。
- Agent Builder 页面包含：
  - 角色选择卡片。
  - 默认核心角色：项目、产品、技术、开发、测试。
  - 开发阶段路线：需求澄清、技术方案、功能实现、质量验证、项目交付。
  - 默认模型选择。
  - 权限策略摘要。
  - 团队摘要。
- 当前页面是 UI 层，不会真正生成/保存工作流。

验证：

- `corepack pnpm build` 成功。

## 2026-05-04 默认对话入口

用户明确希望默认页面极简，只保留类似网页/ChatGPT 的对话入口，后续组建 Agent、生成编排和完成项目开发都通过对话完成，而不是默认展示复杂配置页面。

已完成：

- 新增 `ChatHomePage`。
- 默认页面改为 `chat`。
- 左侧导航新增“对话入口”。
- 对话首页包含：
  - 项目 Chat 说明。
  - 极简对话面板。
  - 当前 Mock Provider 状态提示。
- 编排画布和组建团队页面保留在导航中，作为后续能力入口，不再作为默认展示。

验证：

- `corepack pnpm build` 成功。

## 2026-05-04 极简对话入口收敛

用户进一步明确：不需要默认展示导航、说明卡、组建团队页、编排画布或复杂配置；希望类似 Claude Code 那样，只有一个对话入口，后续编排、对话记忆、Agent 组建和项目开发都通过对话产生。

已完成：

- 新增 `MinimalChatPage`。
- `App` 顶层直接渲染 `MinimalChatPage`。
- 默认页面清空为极简对话窗口：
  - 消息区。
  - 输入框。
  - 发送按钮。
- 保留 Core ChatService 和 Mock Provider 链路。
- 旧画布、团队页组件暂时保留在代码中，但不再进入默认入口。

验证：

- `corepack pnpm build` 成功。

## 2026-05-04 MiMo Provider 接入

用户提供 Python 示例，要求按 Anthropic-compatible 方式调用 MiMo：

- API Key：`MIMO_API_KEY`
- Base URL：最初记录为 `https://api.xiaomimimo.com/anthropic`，后续用户更正为 `https://token-plan-cn.xiaomimimo.com/anthropic`
- Model：`mimo-v2.5-pro`

已完成：

- 安装 `@anthropic-ai/sdk`。
- 新增 MiMo 模型配置：`mimo-v2-5-pro`。
- 新增 `mimo-anthropic` Provider。
- Provider 在 Core 侧读取 `process.env.MIMO_API_KEY`。
- 使用 Anthropic TS SDK 调用 `client.messages.create`。
- MiMo Provider 当前 baseURL 使用 `https://token-plan-cn.xiaomimimo.com/anthropic`。
- 极简 Chat 默认使用 `mimo-v2-5-pro`。
- 新增 `.env.example`。

注意：

- 如果没有配置 `MIMO_API_KEY`，Chat 会返回清晰提示，不会在 Renderer 暴露 key。
- TS SDK 中 `stop_sequences` 类型为 `string[] | undefined`，因此没有传 Python 示例中的 `None/null`。

验证：

- `corepack pnpm build` 成功。

## 2026-05-04 本地 Key 配置

用户希望增加一个 key 配置文件，并且不要提交，同时 TS 代码可以使用。

已完成：

- 新增可提交模板：`config/secrets.example.json`。
- 真实本地配置路径约定为：`config/secrets.local.json`。
- `.gitignore` 已忽略 `config/secrets.local.json`。
- 新增 `packages/core/src/localSecrets.ts`。
- Core 读取 MiMo API Key 的顺序：
  1. `config/secrets.local.json` 中的 `mimoApiKey`。
  2. 环境变量 `MIMO_API_KEY`。

注意：

- 未创建真实 `config/secrets.local.json`，避免误提交或留下假 key。
- Renderer 仍然拿不到 key。

验证：

- `corepack pnpm build` 成功。

## 2026-05-04 本地 Key 读取修复

用户已写入 `config/secrets.local.json`，但应用未生效。

原因判断：

- Electron/Vite dev 运行时 `process.cwd()` 可能不是仓库根目录。
- 原实现只查找 `process.cwd()/config/secrets.local.json`。
- 原实现还缓存读取结果，如果启动时没读到，后续写入也不会刷新。

修复：

- `localSecrets.ts` 改为从当前目录向父级目录逐层查找 `config/secrets.local.json`。
- 移除 secrets 缓存，每次调用重新读取。
- 模型配置列表改为动态函数生成，MiMo 状态会根据当前 key 读取结果判断。

验证：

- `corepack pnpm build` 成功。

## 2026-05-04 Provider GUI 调试面板

用户希望在 GUI 中直接看到接口请求和返回，便于调试模型调用。

已完成：

- 新增 Provider 调试日志类型 `ProviderDebugLog`。
- 新增 Core 内存日志模块 `providerDebugLogs.ts`。
- MiMo Provider 会记录：
  - providerId。
  - model。
  - baseURL。
  - 请求消息数量。
  - 最近一条用户消息。
  - 响应内容。
  - 错误信息。
  - 耗时。
- 调试日志不记录 API Key。
- 新增 IPC：`workbench:list-provider-debug-logs`。
- 极简对话页右上角新增“调试”按钮。
- 调试面板以右侧抽屉展示最近模型请求、返回和错误。

验证：

- `corepack pnpm build` 成功。

## 2026-05-04 Provider 调试请求详情

用户希望调试面板不仅能看接口返回，也能看到请求接口和携带参数。

已完成：

- Provider 调试日志增加请求详情：
  - method。
  - endpoint。
  - headers 安全摘要。
  - body。
- MiMo Provider 记录实际传给 Anthropic SDK 的请求体：
  - model。
  - max_tokens。
  - system。
  - messages。
  - top_p。
  - stream。
  - temperature。
- headers 中 API Key 只显示 `[redacted]`。
- GUI 调试抽屉新增：
  - 请求 Headers。
  - 请求 Body。
  - 响应内容。
  - 错误。

验证：

- `corepack pnpm build` 成功。

## 2026-05-05 Chat 流式输出

用户觉得一次性返回看起来不自然，希望改成流式输出。

已完成：

- 新增共享类型 `ChatStreamEvent`。
- Provider 抽象增加 `streamChat`。
- MiMo Provider 使用 Anthropic SDK 非阻塞流式调用：
  - `stream: true`
  - 监听 `content_block_delta` / `text_delta`
- ChatService 新增 `streamChatMessage`。
- Electron Main 新增 `workbench:stream-chat-message`。
- Preload 新增：
  - `streamChatMessage`
  - `onChatStreamEvent`
- 极简 Chat 页面改为：
  - 发送后立即创建助手消息气泡。
  - 收到 delta 后持续追加内容。
  - done 后同步最终 session。
- 调试日志仍记录最终请求和完整响应。

验证：

- `corepack pnpm build` 成功。

## 2026-05-05 项目瘦身

用户删除了一些文件导致构建报错，并要求清理项目，只保留基础对话入口和交互，其他遗留项先删除。

已完成：

- 删除旧的复杂 UI 页面：
  - `AgentBuilderPage`
  - `AgentFlowNode`
  - `ChatHomePage`
  - `ChatPanel`
  - `workflowViewModel`
- 删除旧的角色/工作流模拟 Core：
  - `roles`
  - `sampleWorkflow`
  - `workflowExecutor`
  - `modelProviders`
- 移除 `@xyflow/react` 依赖。
- 移除 React Flow 样式 import。
- 重写 `styles.css`，只保留极简 Chat 页面和调试抽屉样式。
- 将 MiMo Provider、流式输出、会话和调试日志逻辑收敛到 `chatService.ts`。
- 精简共享类型，只保留 Chat、Provider、调试日志相关类型。

当前保留的源码主线：

- `apps/desktop/src/ui/MinimalChatPage.tsx`
- `packages/core/src/chatService.ts`
- `packages/core/src/localSecrets.ts`
- `packages/core/src/providerDebugLogs.ts`
- `packages/shared/src/index.ts`

注意：

- `apps/memorizes/agents.md` 看起来是用户资料文件，未删除。

验证：

- `corepack pnpm install` 成功。
- `corepack pnpm build` 成功。

## 2026-05-05 Prompt 文件路径修复

用户将系统 Prompt 改为 `readMarkdown("../memorizes/agents.md")` 后提示不对。

原因：

- `readMarkdown` 原实现使用 `path.resolve(filePath)`，这是按运行时当前工作目录解析，不是按 `chatService.ts` 源码文件位置解析。
- Electron/Vite 在 dev 和 build 后的运行目录可能不同，`../memorizes/agents.md` 容易指向错误位置。
- 当前实际 Prompt 文件位于 `packages/memorizes/agents.md`。

修复：

- `readMarkdown` 改为支持从项目根目录解析稳定相对路径。
- `chatService.ts` 改为读取 `packages/memorizes/agents.md`。
- 增加默认中文 System Prompt 兜底，避免文件缺失时传入空 prompt。
- System Prompt 改为每次请求时读取，便于后续编辑 `agents.md` 后快速生效。

验证：

- `corepack pnpm build` 成功。

## 2026-05-05 两段式 Chat 调用链路

用户要求：点击 Enter 后先调用小模型做意图识别，再将识别描述组装进大模型对话上下文。

已完成：

- 新增本地 Ollama 意图识别步骤：
  - Base URL：`http://127.0.0.1:11434`
  - Endpoint：`/api/chat`
  - Model：`qwen2.5:1.5b`
  - `stream: false`
- `streamChatMessage` 调用顺序调整为：
  1. 创建用户消息。
  2. 发送 `stage` 事件：意图识别。
  3. 调用 Ollama 小模型生成中文意图摘要。
  4. 发送 `stage` 事件：大模型对话。
  5. 将意图摘要追加到 MiMo System Prompt。
  6. 调用 MiMo 并保持原有流式输出。
- 调试面板现在会记录两类请求：
  - `ollama-intent`
  - `mimo-anthropic`
- 新增 `ChatStreamEvent` 的 `stage` 事件。
- 极简 Chat 页面增加阶段提示，用户可以看到“意图识别”和“大模型对话”的过渡。
- Ollama 调用失败不会中断主对话，会记录失败日志并用兜底摘要继续调用 MiMo。

验证：

- `corepack pnpm build` 成功。

## 2026-05-05 Core 职责拆分

用户反馈：当前逻辑都在一个文件里，难以阅读；前期不需要过多容错机制；不要使用 `yield` 等冷门语法。

已完成：

- 拆分 `packages/core/src/chatService.ts`：
  - `chatService.ts`：只保留 Chat 两段式流程编排。
  - `chatSessions.ts`：管理内存会话和助手消息追加。
  - `modelConfig.ts`：集中保存 MiMo/Ollama 模型和地址配置。
  - `prompts.ts`：管理意图识别 Prompt 和大模型 System Prompt 组装。
  - `providers/ollamaIntentProvider.ts`：只负责本地 Ollama 意图识别请求。
  - `providers/mimoProvider.ts`：只负责 MiMo 大模型流式请求。
- 移除自有代码中的 `async function*`、`yield`、`yield*` 和 `for await`。
- 流式消息改为普通回调：`streamChatMessage(request, onEvent)`。
- Electron IPC 改为把事件发送函数传给 Core，不再消费异步迭代器。
- 简化前期容错：Ollama 意图识别失败会直接暴露错误，方便开发阶段定位。

验证：

- 使用 `Select-String` 确认源码中没有 `yield|async function*|for await`。
- `corepack pnpm build` 成功。

## 2026-05-05 意图上下文 Role 修正

用户指出：意图识别结果不应该被塞进 `system`，应进入对话上下文里的 role。

修正：

- `system` 现在只读取 `packages/memorizes/agents.md`，用于稳定角色和项目规则。
- 新增 `buildIntentContextMessage`，将 Ollama 意图识别结果包装为本轮内部上下文。
- MiMo 请求的 `messages` 会临时插入一条 `user` role 消息承载意图识别结果。
- 这条意图上下文只存在于本次大模型请求中，不写入真实 ChatSession 历史。

说明：

- Anthropic Messages API 的 `messages` role 只支持 `user` / `assistant`，没有通用 `system` message role；因此内部上下文用 `user` role 包装，并在内容中明确说明它不是用户直接输入。

验证：

- `corepack pnpm build` 成功。

## 2026-05-05 Prompt 模块化

用户反馈：提示词不希望是一整份大文件，手动修改困难，希望拆成模块。

原因：

- 原先 `agents.md` 是一整份 System Prompt，不利于局部修改。
- 用户新增了 `intent.md`，但代码没有进行 `{{input}}` 变量替换，实际只是把文件内容拼接进上下文。
- 部分意图识别 Prompt 仍硬编码在 `prompts.ts` 中。

已完成：

- 新增 `readMarkdownFiles`，支持按顺序读取多个 Markdown 模块并拼接。
- 大模型 System Prompt 改为读取：
  - `packages/memorizes/system/01-role.md`
  - `packages/memorizes/system/02-goals.md`
  - `packages/memorizes/system/03-style.md`
- Ollama 意图识别 Prompt 改为读取：
  - `packages/memorizes/intent/01-parser.md`
  - `packages/memorizes/intent/02-input.md`
- MiMo 临时意图上下文改为读取：
  - `packages/memorizes/context/intent-result.md`
- 新增简单模板变量替换：
  - `{{recent_messages}}`
  - `{{input}}`
  - `{{intent_result}}`
- `prompts.ts` 现在只负责声明模块路径、读取模块、替换变量，不再硬编码大段 Prompt。

注意：

- 旧 `packages/memorizes/agents.md` 和 `packages/memorizes/intent.md` 暂时保留，避免丢失用户手动修改内容；当前主流程不再读取这两个文件。

验证：

- `corepack pnpm build` 成功。

### 下一步建议

1. 接入真实模型 Provider 抽象。
2. 将角色定义改为可配置文件。
3. 实现工作流保存和加载。
4. 增加节点运行实时事件。
5. 增加 Artifact 保存。
6. 增加只读文件工具和权限确认。
