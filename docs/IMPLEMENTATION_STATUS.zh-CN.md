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

## 2026-05-16 记忆系统方向记录

用户希望先记录当前关于记忆系统存储方式的讨论，不急于实现。

设计判断：

- 如果记忆主要给 Agent 自己使用，而不是给人类直接阅读编辑，则不应只依赖 Markdown/文件。
- 重度 AI 用户会产生大量对话、工具调用、项目决策、偏好、代码上下文和任务轨迹。
- Agent 记忆系统的核心能力是查询和召回，而不是保存文档：
  - 按项目 scope 过滤。
  - 按记忆类型过滤。
  - 按重要性、置信度、时间衰减排序。
  - 按来源事件追溯。
  - 未来按语义相似度召回。

长期方向：

- SQLite 作为本地记忆主存储。
- 表层可包含：
  - `events`
  - `memories`
  - `sessions`
  - `memory_embeddings`
- 后续可叠加 `sqlite-vec` / `sqlite-vss` 做本地向量检索。
- 文件系统用于：
  - 大文本。
  - 附件。
  - 项目快照。
  - 导出。
  - 人类可读备份。

当前状态：

- 只记录设计方向，暂不实现数据库记忆系统。

## 2026-05-16 记忆关联模型记录

用户进一步询问：如何关联“关于当前项目的短期记忆对话”和“关于当前项目的整体长期规划”。

设计判断：

- 短期记忆和长期规划不应只是两类文件或两段文本。
- 它们需要共享结构化字段，形成可追溯关系。
- 核心关系：
  - `project_id`：最大作用域，表示属于哪个项目。
  - `session_id`：表示哪一段短期会话。
  - `event_id`：表示原始事件，如用户消息、助手回复、工具调用、意图识别。
  - `memory_id`：表示从事件中提炼出的长期记忆。
  - `source_event_ids`：长期记忆追溯到哪些原始事件。

建议模型：

- `projects`：项目。
- `sessions`：项目下的会话。
- `events`：原始交互和工具事件。
- `memories`：从事件提炼出来的长期事实、偏好、决策、规划。

长期记忆字段建议：

- `project_id`
- `source_session_id`
- `source_event_ids`
- `type`
- `content`
- `tags_json`
- `importance`
- `confidence`
- `created_at`
- `updated_at`
- `last_used_at`

召回策略：

- 先按当前 `project_id` 过滤。
- 再按 `type/tags/importance/time` 查询。
- 数据量增大后叠加 embedding 语义召回。
- 大模型上下文中同时放入：
  - 最近短期事件。
  - 与当前问题相关的长期规划/决策/偏好。
  - 必要的来源摘要。

当前状态：

- 只记录设计方向，暂不实现数据库 schema。

## 2026-05-16 大模型上下文组织格式

用户确认：意图识别是否可以汇总在一起发给模型，并要求记录该格式。

推荐格式：

- `system`：
  - 稳定角色规则。
  - 项目级行为约束。
- `messages[0]`：
  - 使用 `user` role 承载内部上下文。
  - 内容包括最近 intent history、项目记忆、任务状态等。
  - 必须明确说明这不是用户真实输入，而是系统整理的内部上下文。
- 后续 `messages`：
  - 真实对话历史。
  - 必须保持时间顺序。
  - 形如 `user -> assistant -> user -> assistant`。
- 最后一条：
  - 当前用户输入。

不推荐：

- 不要把多轮用户消息、意图识别、助手回复分别分组为：
  - `user1, user2, intent1, intent2, assistant1, assistant2`
- 不要把 intent 作为真实对话每轮穿插：
  - `user1, intent1, assistant1, user2, intent2, assistant2`

原因：

- intent 不是用户真实输入，穿插进真实对话会污染对话因果。
- 汇总为内部上下文更像工作记忆，方便控制长度。
- 真实对话保持时间线，模型更容易理解问答关系。
- 内部上下文集中前置，也更利于后续缓存和裁剪策略。

当前状态：

- 只记录格式，后续实现短期 intent history 和 memory context 时遵循该结构。

## 2026-05-16 max_tokens 后续策略

用户询问：如果模型返回因为达到最大长度而结束，后续应该如何设计。

阶段策略：

- 第一阶段：
  - 不自动续写。
  - 当 `stopReason === "max_tokens"` 时，在最终回复末尾追加提示。
  - 引导用户输入“继续”。
- 第二阶段：
  - UI 显示“继续生成”按钮。
  - 用户点击后再发起续写请求。
  - 保持用户可控，避免无感额外消耗。
- 第三阶段：
  - 可考虑受控自动续写。
  - 必须限制最大续写次数，如 1-2 次。
  - 每次续写仍检查 `stopReason`。
  - 避免无限循环、重复内容、跑偏和成本失控。

续写上下文建议：

- `system`：原稳定系统提示。
- 内部上下文：原项目记忆/任务状态/intent history。
- 对话上下文：
  - 原用户问题。
  - 已生成的截断助手内容。
  - 新用户指令：请从上一条回复中断处继续，不要重复前文。

当前状态：

- 只记录设计策略。当前代码已完成第一阶段的提示策略，不做自动续写。

## 2026-05-16 模型返回异常分类记录

用户询问：处理了 `max_tokens` 结束异常后，还有哪些情况需要考虑，并要求按当前讨论记录。

模型返回后应区分以下状态：

- `complete`
  - 正常结束。
  - 常见 `stopReason`：`end_turn` / `stop` / `stop_sequence`。
  - 正常保存和展示。
- `truncated`
  - 达到最大输出。
  - 常见 `stopReason`：`max_tokens` / `length`。
  - 当前已实现提示策略。
- `empty`
  - 请求没有明显错误，但 `content` 为空。
  - 应提示模型返回为空，不应当作正常助手回复。
- `api_error`
  - API 或网络错误。
  - 包括 401、429、500、超时、baseURL 错误等。
  - 应分类展示清晰错误。
- `structured_output_error`
  - 结构化输出失败。
  - 例如意图识别 JSON 解析失败、字段缺失、intent 不合法。
- `stream_interrupted`
  - 流式输出已经产生部分内容，但连接中断或没有 final message。
  - 应提示内容可能不完整。
- `user_abort`
  - 用户主动停止生成。
  - 不是系统错误，后续加停止按钮时处理。
- `refusal/safety`
  - 模型拒答或安全拦截。
  - 当前阶段暂不优先处理。

建议实现优先级：

1. 已处理：`truncated/max_tokens`。
2. 下一步：`empty response`。
3. 再下一步：`api_error` 分类。
4. 再下一步：`stream_interrupted`。
5. 后续：`user_abort`、`refusal/safety`。

## 2026-05-16 上下文构建模块化记录

用户询问“上下文构建模块化”是什么意思，并确认可理解为将对话信息拆成更多层，最后统一组装。

设计解释：

- 不应把所有内容都当成普通聊天记录直接发给模型。
- 应先拆分成语义层，再由专门模块按固定顺序组装模型请求。

建议上下文层次：

- `system prompt`
  - 稳定角色规则。
  - 项目级行为约束。
- `internal context`
  - 内部上下文，不是用户真实输入。
  - 可包含最近 intent、项目记忆、任务状态、工具结果、当前约束。
- `conversation history`
  - 真实对话历史。
  - 保持 `user -> assistant -> user -> assistant` 时间顺序。
- `current user input`
  - 当前用户输入。

建议模块：

- 后续新增 `modelContextBuilder.ts`。
- 该模块只负责组装：
  - `system`
  - `messages`
- Provider 不再负责业务上下文拼接，只负责调用模型 API。

目标：

- 降低 `mimoProvider.ts` 和 `chatService.ts` 的复杂度。
- 方便后续加入短期 intent history、长期记忆、任务状态、工具结果。
- 方便调试最终发给模型的上下文。

## 2026-05-16 缓存友好的上下文顺序修正

用户指出：如果动态内部上下文直接放在第一条 user message，会导致每轮前缀变化，降低 KV cache / prompt cache 命中。

修正后的顺序：

- `system`
  - 稳定角色规则。
- 稳定上下文
  - 长期项目规则、工具规则、长期偏好等，尽量靠前且少变。
- 真实历史对话
  - 保持时间顺序。
- 本轮动态上下文
  - 当前 taskState。
  - 最近 intent。
  - 最近 toolResult。
  - 当前约束。
- 当前用户输入
  - 放在最后。

代码调整：

- `mimoProvider` 中 MiMo messages 组装顺序从：
  - `runtimeContext -> conversationMessages`
- 调整为：
  - `historyMessages -> runtimeContextMessage -> latestUserMessage`

原因：

- 动态上下文靠近当前输入，可以增强本轮相关性。
- 稳定前缀尽量不变，更有利于缓存命中。
- 真实历史对话仍保持时间顺序。
- 动态上下文需要明确标注不是用户真实输入，避免模型复述或误解。

验证：

- `corepack pnpm build` 成功。

## 2026-05-16 会话压缩规则记录

用户提醒：上下文链路里还需要明确“会话压缩”规则。

设计判断：

- 会话压缩不是每轮都做。
- 会话压缩也不是 KV cache / prompt cache 本身。
- KV cache / prompt cache 依赖尽量稳定的请求前缀；如果每轮都把历史重新压缩成不同文本，反而会降低缓存命中。
- 因此第一版采用“多轮累积后再压缩”的策略。

第一版触发条件：

- 当前会话真实历史超过固定轮数，例如 12-20 轮。
- 或预计上下文 token 超过预算阈值，例如达到模型上下文预算的 60%-70%。
- 或任务阶段发生明显切换，例如从需求讨论进入实现、从实现进入验证。
- 或用户显式要求“总结一下/记录一下/压缩上下文”。

第一版不触发压缩的情况：

- 普通短对话。
- 当前任务还在快速来回确认细节，且历史不长。
- 工具调用刚执行完，还需要保留原始输出用于下一步判断。

压缩对象：

- 只压缩较早的真实对话历史。
- 不压缩最近 3-5 轮真实对话。
- 不压缩当前用户输入。
- 不压缩本轮动态上下文，例如当前 Router 结果、toolResult、focused task。
- 不把长期记忆和会话摘要混为一类。

压缩产物：

- `session_summary`
  - 当前会话到目前为止的摘要。
  - 用于替代被裁剪掉的早期对话。
- `decisions`
  - 明确的项目决策。
  - 可进一步沉淀为长期记忆。
- `open_questions`
  - 尚未确认的问题。
- `constraints`
  - 用户偏好、技术边界、权限边界。
- `task_progress`
  - 当前任务进度、已完成事项、下一步。
- `source_range`
  - 摘要覆盖的消息范围，便于追溯。

传给模型时的建议顺序：

1. `system`：稳定角色和项目规则。
2. 稳定项目上下文：长期偏好、工具规则、长期项目决策。
3. `session_summary`：被压缩的较早会话摘要。
4. 最近 3-5 轮真实对话：保持 `user -> assistant` 时间顺序。
5. 本轮动态上下文：Router 结果、focused task、toolResult、临时约束。
6. 当前用户输入。

存储策略：

- 第一版会话压缩结果写入 SQLite，而不是只放内存。
- 建议表：
  - `conversation_summaries`
  - 字段包括：`id`、`project_id`、`session_id`、`source_start_event_id`、`source_end_event_id`、`summary`、`decisions_json`、`open_questions_json`、`constraints_json`、`task_progress_json`、`created_at`、`updated_at`。
- 原始 events 不删除，只是在上下文构建时被 summary 替代。
- 后续可将高价值 decisions/constraints 再提升到 `memories` 表。

压缩模型：

- 第一版可以继续使用本地小模型或主模型。
- 如果要求质量稳定，优先用主模型做压缩。
- 如果考虑成本和速度，可先用小模型做草稿，再由 Core 做结构校验。

实现位置建议：

- `conversationCompressor.ts`
  - 判断是否需要压缩。
  - 调用模型生成压缩结果。
  - 校验结构化结果。
- `modelContextBuilder.ts`
  - 读取会话摘要和最近对话。
  - 按固定顺序组装最终上下文。

当前状态：

- 已记录明确规则。
- 尚未实现会话压缩代码和 SQLite 表。

## 2026-05-16 会话压缩第一版实现

用户要求开始操作后，已将会话压缩从设计推进到第一版代码。

已完成：

- 安装 `better-sqlite3` 和类型依赖。
- `pnpm-workspace.yaml` 放行 `better-sqlite3` build script。
- `.gitignore` 忽略本地 SQLite 数据文件：
  - `data/*.db`
  - `data/*.db-shm`
  - `data/*.db-wal`
- 新增 SQLite 初始化：
  - `packages/core/src/storage/database.ts`
  - 默认数据库路径：`data/agent.db`
- 新增会话摘要存取：
  - `packages/core/src/conversationSummaries.ts`
  - 表：`conversation_summaries`
- 新增会话压缩判断：
  - `packages/core/src/conversationCompressor.ts`
  - 当前阈值：消息数达到 24 条后才考虑压缩。
  - 默认保留最近 10 条消息。
  - 每次至少有 6 条新消息才触发增量压缩。
- 新增 Ollama 压缩 Provider：
  - `packages/core/src/providers/ollamaCompressionProvider.ts`
  - 继续使用本地 `qwen2.5:1.5b`。
  - 使用 `format: "json"` 要求返回结构化摘要。
- 新增压缩 Prompt 模块：
  - `packages/memorizes/compression/01-system.md`
  - `packages/memorizes/compression/02-input.md`
- ChatService 每轮流程新增：
  1. 检查会话压缩。
  2. 意图识别。
  3. 大模型对话。
- MiMo 上下文组装新增会话摘要支持：
  - 如果存在摘要，会用摘要替代较早历史消息。
  - 保留摘要之后的真实对话。
  - 本轮 intent 动态上下文仍放在当前用户输入前。

当前限制：

- 原始 messages 目前仍主要存在内存 ChatSession 中，尚未完整写入 `events` 表。
- 会话压缩结果已写入 SQLite，但还没有 UI 专门展示。
- 当前触发规则按消息数实现，token 预算触发还未实现。
- 当前使用小模型做压缩，后续可改为主模型或“小模型草稿 + 主模型校正”。
- 当前没有自动把高价值 `decisions/constraints` 提升为长期 `memories`。

验证：

- `better-sqlite3` native binding 已实际加载成功。
- `corepack pnpm build` 成功。

## 2026-05-16 Events 原始事件链第一版实现

在会话压缩第一版之后，继续补齐 SQLite 原始事件链。

设计目的：

- 会话摘要不应成为唯一历史来源。
- 原始用户消息、助手消息、Router 结果、模型返回状态和压缩摘要都需要可追溯。
- 后续记忆系统、任务状态、多 Agent 编排、Agent Trace 都可以基于 events 扩展。

已完成：

- SQLite 新增 `events` 表。
- 字段包括：
  - `id`
  - `project_id`
  - `session_id`
  - `message_id`
  - `type`
  - `actor`
  - `role_label`
  - `content`
  - `payload_json`
  - `created_at`
- 新增索引：
  - `idx_events_session`
  - `idx_events_message_id`
- 新增事件模块：
  - `packages/core/src/events.ts`
- 当前事件类型：
  - `chat_message`
  - `router_result`
  - `conversation_summary`
  - `model_return`
  - `error`
- ChatService 已接入事件写入：
  - 用户消息创建后写入 `chat_message`。
  - Router 结果写入 `router_result`。
  - MiMo 返回 stopReason/usage 写入 `model_return`。
  - 助手消息写入 `chat_message`。
- 会话压缩完成后写入 `conversation_summary` 事件。
- Core 导出 `listSessionEvents`，后续 UI/Trace 可以直接读取。

当前限制：

- events 已写入 SQLite，但 UI 还没有展示。
- 错误事件类型已预留，当前 catch 链路还未统一写入 `error`。
- 当前 ChatSession 仍是内存会话，events 还没有反向恢复会话能力。
- 工具调用、任务状态、多 Agent run 尚未接入 events。

验证：

- `better-sqlite3` 内存表读写验证成功。
- `corepack pnpm build` 成功。

## 2026-05-16 Events GUI 可观测性第一版

在原始事件链写入 SQLite 后，继续将 events 接入 GUI 调试面板。

已完成：

- 共享类型新增：
  - `AgentEventType`
  - `AgentEventRecord`
- Electron Main 新增 IPC：
  - `workbench:list-session-events`
- Preload 新增 API：
  - `window.workbench.listSessionEvents`
- Core 已导出的 `listSessionEvents` 接入 Electron。
- 极简 Chat 调试抽屉新增两个 Tab：
  - `模型请求`
  - `事件链`
- `事件链` 视图展示：
  - event type
  - actor
  - roleLabel
  - messageId
  - createdAt
  - content
  - payload JSON
- 每轮对话 done 后自动刷新当前 session events。
- 手动点击刷新按钮也会同时刷新模型请求日志和事件链。

当前效果：

- 用户可以在 GUI 里看到一轮对话背后的原始事件：
  - 用户消息。
  - Router 结果。
  - MiMo stopReason/usage。
  - 助手消息。
  - 会话压缩摘要事件。
- 这一步是 Agent Trace 的前置可视化版本。

当前限制：

- 还不是完整 Agent Trace 时间线。
- 没有事件过滤、搜索、导出。
- 事件链只显示当前 session 最近 100 条。
- 当前还没有工具调用和任务状态事件。

验证：

- `corepack pnpm build` 成功。

## 2026-05-16 Router 完整 Schema 第一版实现

在 Events GUI 可观测性之后，继续补齐此前确认过的 Router 完整结构。

已完成：

- 共享类型新增：
  - `RouterIntent`
  - `RouterTaskType`
  - `RouterResult`
- `packages/memorizes/intent/01-parser.md` 从旧版 intent parser 升级为 Router parser。
- Router 输出字段升级为：
  - `intent`
  - `rewritten_input`
  - `keywords`
  - `is_task`
  - `task_goal`
  - `task_type`
  - `requires_project_context`
  - `needs_tools`
  - `suggested_tools`
  - `tool_reason`
  - `confidence`
- `ollamaIntentProvider.ts` 改为返回结构化 `RouterResult`，不再只返回字符串。
- Core 对 Router 结果做基础归一化：
  - `intent` 必须合法，否则报错。
  - `task_type` 非法时按 intent 推导默认值。
  - `suggested_tools` 第一版只允许 `command.run`。
  - `confidence` 被限制在 0-1。
  - `needs_tools=true` 但没有工具时，默认补 `command.run`。
- ChatService 将 RouterResult 格式化后注入 MiMo 内部上下文。
- `router_result` event 现在保存完整 Router JSON payload。
- 阶段提示会显示 Router 判断：
  - `intent`
  - `task_type`
  - `confidence`

同时补齐：

- 新增 `saveErrorEvent`。
- ChatService 外层错误统一写入 `error` event。
- Router 失败、会话压缩失败、MiMo 失败都能进入 GUI 事件链。

当前限制：

- Router 结果还没有驱动真实 tool selection。
- Router 结果还没有自动创建/更新任务状态。
- `confidence >= 0.7` 的策略尚未接入 Core Policy。
- `suggested_tools` 目前只允许 `command.run`，但 Command Gateway 尚未实现。

验证：

- `corepack pnpm build` 成功。

## 2026-05-16 Tool Selection Policy 第一版实现

在 Router 完整 Schema 之后，继续让 Router 结果驱动 Core 的工具选择策略。

已完成：

- 共享类型新增：
  - `ToolAccessMode`
  - `ToolSelectionResult`
- 新增 Core 模块：
  - `packages/core/src/toolSelectionPolicy.ts`
- 新增事件类型：
  - `tool_selection`
- 新增事件写入：
  - `saveToolSelectionEvent`
- ChatService 在 Router 之后立即执行工具选择。
- 工具选择结果写入 SQLite events。
- 工具选择结果和 Router 结果一起注入 MiMo 内部运行上下文。
- GUI 的 `事件链` Tab 会展示 `tool_selection` 事件。

第一版规则：

- Router 置信度阈值使用 `0.7`。
- `confidence < 0.7` 时不自动开放工具。
- `chat` 不开放工具。
- `search` 暂不开放工具，因为 `web.search` 尚未实现。
- `analysis` 且不需要项目上下文时不开放工具。
- 第一版可选工具只有 `command.run`。
- `code` / `implementation` 对应 `project_write`。
- `debug` / `debugging` / `verification` 对应 `project_verify`。
- 普通项目分析对应 `project_read`。

当前限制：

- 这里只是“选择工具”，还不会执行工具。
- `Command Gateway` 尚未实现。
- `access_mode` 只是传递给后续 Gateway 的策略信号。
- 还没有 UI 专门高亮展示 selected tools，只能在事件链里看 JSON。

验证：

- `corepack pnpm build` 成功。

## 2026-05-16 Command Gateway 第一版实现

在 Tool Selection Policy 之后，继续实现 `command.run` 的本地执行入口。

已完成：

- 共享类型新增：
  - `CommandRunRequest`
  - `CommandDecision`
  - `CommandRunResult`
- 新增工具调用解析模块：
  - `packages/core/src/toolCallParser.ts`
- 新增 Command Gateway：
  - `packages/core/src/commandGateway.ts`
- 事件类型新增：
  - `tool_call`
  - `tool_result`
- 事件写入新增：
  - `saveToolCallEvent`
  - `saveToolResultEvent`
- MiMo 内部运行上下文新增工具请求协议说明。
- ChatService 在 MiMo 回复结束后：
  1. 解析回复中的 `command.run` JSON 请求。
  2. 最多处理 8 条。
  3. 写入 `tool_call` event。
  4. 交给 Command Gateway 判断并执行/拒绝/跳过。
  5. 写入 `tool_result` event。
  6. 将工具执行结果追加到当前助手消息。

第一版执行边界：

- 只支持 PowerShell。
- `cwd` 必须位于当前工作区内。
- 默认超时 30 秒。
- build/test 类命令超时 120 秒。
- stdout/stderr 默认截断到约 20,000 字符。
- 危险命令直接拒绝：
  - `Invoke-Expression`
  - `iex`
  - `curl |`
  - `irm`
  - `iwr`
  - `format`
  - `diskpart`
  - `shutdown`
  - `restart-computer`
  - `remove-item -recurse`
  - `rm -r`
  - `rmdir /s`
  - `del /s`
  - `set-executionpolicy`

access mode 策略：

- `project_read`
  - 只允许读类命令，如 `Get-ChildItem`、`Get-Content`、`Select-String`、`Test-Path`、`Resolve-Path`、`git status/diff/log`。
- `project_verify`
  - 允许读类命令和 build/test 类验证命令。
- `project_write`
  - 允许读、验证和未命中危险/确认规则的项目内命令。
- 需要确认但当前没有确认 UI 的命令会返回 `confirm/skipped`，不会执行：
  - `git add`
  - `git commit`
  - `git push`
  - `pnpm add`
  - `npm install`
  - `corepack pnpm add`

当前限制：

- 这是“一步工具执行”，不是完整多轮 ReAct 循环。
- 工具执行后暂时不会自动再调用 MiMo 总结结果。
- 还没有用户确认 UI，因此 `confirm` 命令会跳过。
- 还没有专门的 Tool 面板，只能在事件链和助手消息里查看结果。
- 还没有任务状态联动。

验证：

- `corepack pnpm build` 成功。

## 2026-05-16 一步 ReAct 工具结果整理

在 Command Gateway 第一版之后，继续补齐工具执行后的模型整理步骤。

已完成：

- ChatService 在执行 `command.run` 后，如果存在工具结果，会追加一次 MiMo 调用。
- 第二次 MiMo 调用只负责读取工具结果并生成最终回应。
- 第二次调用不会继续解析工具请求，避免无限工具循环。
- UI 会显示阶段：
  - `工具执行`
  - `工具结果整理`
- 最终助手消息结构：
  - 保留第一次 MiMo 的工具请求/说明。
  - 追加 `【工具结果整理】`。
  - 流式展示第二次 MiMo 基于工具结果生成的最终回应。
- 事件链顺序调整：
  - 第一次 MiMo `model_return`。
  - `tool_call`。
  - `tool_result`。
  - 第二次 MiMo `model_return`。
  - 最终 `chat_message`。

当前限制：

- 仍然只允许一次工具后续整理。
- 第二次 MiMo 结果不会再次触发工具解析。
- 第一次 MiMo 生成的 `command.run` JSON 仍会在消息里可见，后续可优化为隐藏工具请求块。
- 还没有用户确认 UI。

验证：

- `corepack pnpm build` 成功。

## 2026-05-16 工具请求块隐藏

在一步 ReAct 工具结果整理之后，继续优化用户可见消息体验。

问题：

- MiMo 为了请求工具会输出 `command.run` JSON。
- 这段 JSON 对系统有用，但不应该长期作为普通回答展示给用户。
- 调试和追溯应放在事件链，而不是污染对话正文。

已完成：

- `ChatStreamEvent` 新增：
  - `replace`
- Renderer 支持 `replace` 事件，用于替换当前助手消息内容。
- `toolCallParser.ts` 新增：
  - `removeCommandRunRequestBlocks`
- ChatService 在第一次 MiMo 返回后：
  1. 保留原始内容用于解析 `command.run`。
  2. 清理用户可见内容中的工具请求 JSON 代码块。
  3. 如果清理结果不同，发送 `replace` 事件更新聊天气泡。
  4. `tool_call` event 仍保存完整工具请求。
  5. 最终 `chat_message` 只保存清理后的可见文本和工具结果整理。

当前效果：

- 聊天气泡不再长期展示 `command.run` JSON。
- 事件链仍可查看完整 `tool_call` 和 `tool_result`。
- 工具结果整理仍会流式显示。

当前限制：

- 如果模型输出非 JSON 代码块形式的工具请求，第一版可能无法隐藏。
- 流式过程中 JSON 可能短暂出现，等第一次 MiMo 完成并解析后会被替换。

验证：

- `corepack pnpm build` 成功。

## 2026-05-16 模型调用抽离与可视化配置

用户希望把大模型和小模型 API 调用抽离出来，改成可视化可配置的方式，例如可以使用 DeepSeek 作为前置 Router 和主实现模型。

已完成：

- 新增模型运行时配置类型：
  - `ModelRuntimeRole`
  - `ModelProviderKind`
  - `ModelRuntimeConfig`
  - `ModelRuntimeSettings`
- 新增本地配置文件模板：
  - `config/model-runtime.example.json`
- 新增本地真实配置路径：
  - `config/model-runtime.local.json`
- `.gitignore` 已忽略：
  - `config/model-runtime.local.json`
- 新增 Core 配置模块：
  - `packages/core/src/modelRuntimeConfig.ts`
- Electron IPC 新增：
  - `workbench:get-model-runtime-settings`
  - `workbench:save-model-runtime-settings`
- Preload 新增：
  - `window.workbench.getModelRuntimeSettings`
  - `window.workbench.saveModelRuntimeSettings`
- GUI 右上角新增 `模型` 按钮。
- 模型配置抽屉支持配置三类模型：
  - `router`：前置意图识别 / Router。
  - `main`：主对话 / 实现模型。
  - `compression`：会话压缩模型。
- 每类模型可配置：
  - 名称。
  - Provider 类型。
  - Base URL。
  - Model。
  - API Key。
  - Temperature。
  - Max Tokens。
- GUI 新增 `使用 DeepSeek 预设`：
  - Router：`openai-compatible` + `https://api.deepseek.com` + `deepseek-v4-flash`
  - Main：`openai-compatible` + `https://api.deepseek.com` + `deepseek-v4-pro`
  - Compression：`openai-compatible` + `https://api.deepseek.com` + `deepseek-v4-flash`

Provider 抽离：

- 新增 OpenAI-compatible Provider：
  - `packages/core/src/providers/openAiCompatibleProvider.ts`
- 支持：
  - 非流式 JSON 调用，用于 Router / Compression。
  - 流式 Chat Completions，用于 Main。
- Router 调用支持：
  - `ollama`
  - `openai-compatible`
- Compression 调用支持：
  - `ollama`
  - `openai-compatible`
- Main 调用支持：
  - `anthropic-compatible`
  - `openai-compatible`
- 默认配置保持兼容：
  - Router：本地 Ollama `qwen2.5:1.5b`
  - Main：MiMo Anthropic-compatible `mimo-v2.5-pro`
  - Compression：本地 Ollama `qwen2.5:1.5b`

上下文顺序修正：

- OpenAI-compatible 主模型也保持缓存友好的上下文顺序：
  - system
  - 历史对话
  - 内部运行上下文
  - 当前用户输入

当前限制：

- Router / Compression 暂不支持 Anthropic-compatible。
- OpenAI-compatible Provider 使用 fetch 实现基础 Chat Completions，不依赖 SDK。
- 还没有模型连通性测试按钮。
- API Key 当前保存到本地 `config/model-runtime.local.json`，不会提交，但还没有做系统级加密存储。

验证：

- `corepack pnpm build` 成功。

## 2026-05-16 GUI 暗色模式

用户希望 GUI 改成暗色模式。

已完成：

- `apps/desktop/src/styles.css` 改为默认暗色主题。
- 使用 CSS variables 统一管理背景、面板、边框、文本、强调色和危险色。
- 覆盖极简对话入口：
  - 页面背景。
  - 消息气泡。
  - 输入框。
  - 发送按钮。
  - 阶段提示。
- 覆盖右侧调试抽屉：
  - 模型请求日志。
  - 事件链。
  - JSON/Pre 输出。
  - Tab 和操作按钮。
- 覆盖模型配置抽屉：
  - Provider 卡片。
  - 输入项。
  - 预设按钮。
  - 保存状态。

当前状态：

- GUI 默认进入暗色模式。
- 暂未实现亮色/暗色切换开关。

验证：

- `corepack pnpm build` 成功。

## 2026-05-16 流式 IPC 返回修复

用户发送消息时遇到：

```text
Error invoking remote method 'workbench:stream-chat-message': reply was never sent
```

原因判断：

- `workbench:stream-chat-message` 是 `ipcRenderer.invoke` / `ipcMain.handle` 链路。
- 主进程 handler 在流式发送完成后没有显式返回值，某些异常、热更新或窗口状态变化路径下可能导致 renderer 侧认为这次 invoke 没有收到回复。
- 前端在 invoke 失败时没有保证移除 `workbench:chat-stream-event` 监听器，后续可能出现重复监听。

修复：

- `apps/desktop/electron/main.ts` 中 `workbench:stream-chat-message` 完成后显式返回 `{ ok: true }`。
- 发送流式事件前检查 `event.sender.isDestroyed()`，避免窗口刷新或关闭时继续向失效 sender 发送事件。
- `apps/desktop/src/ui/MinimalChatPage.tsx` 将流式监听器清理移动到 `finally`，确保成功和失败路径都会移除监听。
- Electron 窗口 `backgroundColor` 同步改为暗色，避免暗色模式启动时闪白。

验证：

- `corepack pnpm build` 成功。

## 2026-05-16 better-sqlite3 打包修复

用户运行时遇到：

```text
UnhandledPromiseRejectionWarning: ReferenceError: __filename is not defined
```

原因判断：

- 项目是 ESM 环境，主进程源码本身没有直接使用 `__filename`。
- 报错来自 `better-sqlite3` 依赖链中的 CommonJS/native 加载逻辑。
- Vite 将 `better-sqlite3` 打进 Electron main 的 ESM bundle 后，依赖内部仍引用 CommonJS 变量 `__filename`，运行时无法解析。

修复：

- `apps/desktop/vite.config.ts` 中 Electron main 构建增加 external：
  - `better-sqlite3`
- 让 `better-sqlite3` 在运行时按 Node 原生 CommonJS 包加载，避免被打包进 ESM 产物。

验证：

- `corepack pnpm build` 成功。
- 构建后的 `apps/desktop/dist-electron/main.js` 中已搜不到 bundled `bindings` / `__filename` 触发代码。
- `corepack pnpm --filter @xiaomi/desktop dev` 未立即抛出 `__filename` 错误，进程保持运行直到调试超时被中断。

## 2026-05-16 better-sqlite3 运行时解析修复

用户继续遇到：

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'better-sqlite3' imported from D:\AICode\XiaoMiCode\apps\desktop\dist-electron\main.js
```

原因判断：

- 上一步将 `better-sqlite3` external 掉是正确的，因为它不能被 Vite 打进 ESM bundle。
- 但 external 后，运行时 `apps/desktop/dist-electron/main.js` 会从 `apps/desktop` 的依赖树解析 `better-sqlite3`。
- 当时 `better-sqlite3` 只声明在 `packages/core/package.json`，没有声明在 `apps/desktop/package.json`，所以 Electron main 运行时找不到包。

修复：

- `apps/desktop/package.json` 增加运行时依赖：
  - `better-sqlite3`
- 执行 `corepack pnpm install`，让 pnpm 在 `apps/desktop/node_modules` 下创建正确链接。

验证：

- `Test-Path apps/desktop/node_modules/better-sqlite3` 返回 `True`。
- `corepack pnpm --filter @xiaomi/desktop typecheck` 成功。
- `corepack pnpm build` 成功。
- 从 `apps/desktop` 目录执行 Node ESM 导入 `better-sqlite3` 并创建内存 SQLite 表成功，输出 `ok`。
- 受控启动 `corepack pnpm --filter @xiaomi/desktop dev` 成功：
  - Vite ready。
  - main/preload development build 完成。
  - Electron 主进程启动。
  - 未再出现 `ERR_MODULE_NOT_FOUND` 或 `__filename is not defined`。

## 2026-05-16 better-sqlite3 Electron ABI 修复

用户发送消息时继续遇到：

```text
The module 'better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 127.
This version of Node.js requires NODE_MODULE_VERSION 130.
```

原因判断：

- 普通 Node 当前 ABI 是 `127`。
- Electron 33.4.11 内置 Node 运行时需要 ABI `130`。
- `better-sqlite3` 是 native module，不能只按普通 Node 编译；Electron main 进程加载时必须使用 Electron ABI 编译后的 `.node` 文件。

修复：

- `apps/desktop/package.json` 新增开发依赖：
  - `@electron/rebuild`
- 新增脚本：
  - `rebuild:native`: `electron-rebuild -f -w better-sqlite3`
- 根目录 `package.json` 新增：
  - `postinstall`: `pnpm --filter @xiaomi/desktop rebuild:native`
- 保持 `dev/build` 不自动强制 rebuild，避免 Electron 应用运行时 Windows 锁住 `.node` 文件导致 `EPERM unlink`。
- 正确使用方式：
  - 安装依赖后会自动 rebuild。
  - 如果手动遇到 ABI mismatch，先关闭 Electron 应用，再运行 `corepack pnpm --filter @xiaomi/desktop rebuild:native`。

验证：

- 关闭残留项目 Electron/Vite 进程后，`corepack pnpm --filter @xiaomi/desktop rebuild:native` 成功。
- `corepack pnpm --filter @xiaomi/desktop typecheck` 成功。
- `corepack pnpm build` 成功。
- 使用 Electron 自带 Node 运行时验证 SQLite：
  - 设置 `ELECTRON_RUN_AS_NODE=1`。
  - 从 `apps/desktop` 导入 `better-sqlite3`。
  - 创建内存 SQLite 表并查询成功，输出 `electron-ok`。
- 受控启动 `corepack pnpm --filter @xiaomi/desktop dev` 成功：
  - Vite ready。
  - main/preload development build 完成。
  - Electron 主进程启动。
  - 未出现 `NODE_MODULE_VERSION`、`ERR_MODULE_NOT_FOUND` 或 `__filename is not defined`。

## 2026-05-16 工具系统方向记录

用户希望尽快跑起来，并明确不想第一版为所有能力都封装独立工具函数，而是希望通过 CLI/Shell 放行大量安全操作。

设计判断：

- 第一版不优先做 `file.read`、`file.write`、`workspace.listFiles` 等大量专用工具函数。
- 优先做一个通用 `command.run`。
- `command.run` 可作为模型侧 function call 协议。
- `command.run` 内部走 `Command Gateway`。

Function Call 与 Command Gateway 的区别：

- Function Call：
  - 模型到系统的结构化调用协议。
  - 负责让模型以 JSON/schema 方式表达“我要调用什么”。
- Command Gateway：
  - 本地执行模式。
  - 负责解析命令、判断风险、执行命令、返回结果。

建议第一版链路：

1. 模型输出 `command.run` 请求。
2. Core 解析 `shell/cwd/command`。
3. Command Gateway 按策略分类：
   - `allow`
   - `confirm`
   - `deny`
4. `allow` 自动执行。
5. `confirm` 交给 UI 请求用户确认。
6. `deny` 直接拒绝。
7. 执行结果返回模型并展示到调试面板。

初步自动放行：

- `Get-ChildItem`
- `Get-Content`
- `Select-String`
- `Test-Path`
- `Resolve-Path`
- `git status`
- `git diff`
- `git log`
- `pnpm build`
- `pnpm test`

需要确认：

- 写文件。
- 删除、移动、复制。
- 新建文件。
- `git add`
- `git commit`
- `git push`
- 安装依赖。
- 未知命令。

禁止：

- 系统目录递归删除。
- 格式化磁盘。
- `curl | iex`
- `Invoke-Expression`
- 越出工作区的破坏性操作。

后续演进：

- 先用 `command.run` 获得开发灵活性。
- 高频且需要更强安全边界的能力，再抽成专用工具：
  - `memory.search`
  - `project.updateTask`
  - `file.applyPatch`

用户确认的第一版默认策略：

- `pnpm build` 可以自动执行。
- `pnpm test` 可以自动执行。
- 工作区内写文件无需确认。
- 每轮最多执行 8 个命令。
- 仍需保留工作区边界和危险命令禁止策略。

## 2026-05-16 Command Gateway 收口方案

用户表示：如果已有主意就按当前方案推进，不能确认的再询问，希望把工具系统设计收尾。

第一版固定边界：

- 只支持 PowerShell。
- 不支持 cmd/bash 多 shell。
- 默认工作区为当前项目：`D:\AICode\XiaoMiCode`。
- `cwd` 必须位于工作区内。
- 每轮最多执行 8 个命令。
- 默认 timeout：30 秒。
- `pnpm build` / `pnpm test` timeout：120 秒。
- stdout/stderr 默认各截断到约 20,000 字符。

命令请求协议：

```json
{
  "type": "command.run",
  "reason": "说明为什么要执行这条命令",
  "shell": "powershell",
  "cwd": "D:\\AICode\\XiaoMiCode",
  "command": "Get-Content -LiteralPath 'package.json' -Raw"
}
```

执行流程：

1. 模型产生 `command.run` 请求。
2. Core 生成 command plan，不直接执行。
3. Command Policy 判断为 `allow` / `confirm` / `deny`。
4. `allow` 自动执行。
5. `confirm` 第一版可先暂停并提示用户，复杂确认 UI 后续再做。
6. `deny` 直接拒绝并返回原因。
7. 执行结果回传模型，作为内部上下文。
8. 记录审计日志。

审计日志字段：

- `sessionId`
- `turnId`
- `reason`
- `shell`
- `cwd`
- `command`
- `decision`
- `status`
- `exitCode`
- `stdout`
- `stderr`
- `durationMs`
- `createdAt`

第一版暂不做：

- 多 shell。
- 后台长任务。
- 自动安装依赖。
- 自动 git commit / push。
- 无限工具循环。
- 完整数据库审计日志。
- 复杂确认 UI。

## 2026-05-16 工具选择策略记录

用户确认：Core 的作用可以理解为通过代码识别意图，不是每次一次性把所有工具都传给 LLM。随后询问如何判断工具类型。

设计原则：

- 工具选择和命令安全分两层：
  - `toolSelectionPolicy`：Core 根据 intent 决定本轮给大模型哪些工具。
  - `commandPolicy`：Command Gateway 判断具体命令是否 `allow/confirm/deny`。
- 第一版不需要复杂工具类型判断，用 intent 到工具的规则映射即可。

第一版映射：

- `chat`
  - 不暴露工具。
- `analysis`
  - 默认不暴露工具。
  - 如果输入提到项目、文件、代码、当前实现，则暴露 `command.run` 的项目只读/验证能力。
- `debug`
  - 暴露 `command.run`。
  - 允许读文件、跑 build/test。
- `code`
  - 暴露 `command.run`。
  - 允许读写工作区文件、跑 build/test。
- `search`
  - 后续暴露 `web.search`。
  - 当前阶段可暂不实现。

关键边界：

- 给模型 `command.run` 不代表所有命令都能执行。
- 所有具体命令仍必须经过 Command Gateway 的 allow/confirm/deny。
- 这样可以减少上下文长度、模型困惑、token 成本、工具误用和安全风险。

## 2026-05-16 任务状态系统方向记录

用户希望继续设计任务状态系统，并进一步说明未来会有多个 Agent 反复调用执行，因此不应按“只允许一个 active task”的简化模型设计。

核心修正：

- 不限制一个项目只能有一个 `active task`。
- 一个项目可以有多个 `active tasks`。
- 当前对话回合或当前 agent run 只聚焦一个 `focusedTaskId`。

概念区分：

- `active task`
  - 项目中正在进行的任务。
  - 可以有多个。
- `focused task`
  - 当前对话/当前 agent run 正在处理的任务。
  - 每次上下文默认只展开一个。
- `agent run`
  - 某个 Agent 角色围绕某个任务的一次执行。
  - 未来可支持产品、技术、开发、测试等多个角色反复处理不同任务。

第一版存储方向：

- 用户希望第一次就上 SQLite。
- 因此任务状态不走内存临时版。
- 任务系统与未来记忆系统一样，优先采用本地 SQLite。

建议 SQLite 表：

- `tasks`
  - 任务主体。
  - 字段建议：`id`、`project_id`、`title`、`goal`、`type`、`status`、`phase`、`created_at`、`updated_at`、`completed_at`。
- `task_steps`
  - 子步骤。
  - 字段建议：`id`、`task_id`、`title`、`status`、`order_index`、`created_at`、`updated_at`。
- `task_blockers`
  - 阻塞点。
  - 字段建议：`id`、`task_id`、`content`、`status`、`created_at`、`resolved_at`。
- `task_focus`
  - 当前项目的聚焦任务。
  - 字段建议：`project_id`、`focused_task_id`、`updated_at`。
- `agent_runs`
  - 某个 Agent 对某个 task 的一次执行。
  - 字段建议：`id`、`project_id`、`task_id`、`agent_role`、`status`、`input_json`、`output_json`、`started_at`、`completed_at`。
- `task_dependencies`
  - 任务之间的依赖关系。
  - 字段建议：`task_id`、`depends_on_task_id`。

TaskState 字段方向：

- `id`
- `projectId`
- `title`
- `goal`
- `type`
  - `chat`
  - `analysis`
  - `design`
  - `implementation`
  - `debugging`
  - `verification`
- `status`
  - `active`
  - `paused`
  - `completed`
  - `blocked`
- `phase`
  - `understanding`
  - `planning`
  - `executing`
  - `verifying`
  - `summarizing`
- `steps`
- `blockers`
- `createdAt`
- `updatedAt`

传给模型的上下文策略：

- 不把所有 active tasks 全量传给模型。
- 只传：
  - focused task 详情。
  - 相关依赖任务摘要。
  - 其他 active tasks 简短列表。
- 放在本轮动态上下文中，位置靠近当前用户输入。

示例：

```md
【当前任务状态】

当前聚焦任务：
- id: task-impl-command-gateway
- 类型: implementation
- 状态: active
- 阶段: executing
- 目标: 实现 Command Gateway 第一版

依赖任务：
- task-design-command-gateway: completed

其他进行中任务：
- task-memory-system: planning
- task-model-return-policy: verifying
```

当前状态：

- 已记录设计方向。
- 尚未实现 SQLite schema 和任务状态读写。

## 2026-05-16 Router Schema 确认

用户确认：小模型 Router 按当前 schema 继续推进。

Router 定位：

- Router 是前置小模型输出给 Core 的“路由报告”。
- Router 不回答用户。
- Router 不直接执行工具。
- Router 不直接创建任务。
- Router 只提供结构化建议，Core 负责校验、修正和执行策略。

第一版字段：

```json
{
  "intent": "chat | analysis | code | debug | search",
  "rewritten_input": "",
  "keywords": [],
  "is_task": false,
  "task_goal": "",
  "task_type": "chat | analysis | design | implementation | debugging | verification",
  "requires_project_context": false,
  "needs_tools": false,
  "suggested_tools": ["command.run"],
  "tool_reason": "",
  "confidence": 0.0
}
```

字段含义：

- `intent`
  - 当前输入的大类意图。
- `rewritten_input`
  - 保持原意的清晰重写。
- `keywords`
  - 核心关键词。
- `is_task`
  - 是否是需要持续推进的任务。
- `task_goal`
  - 如果是任务，任务目标是什么。
- `task_type`
  - 当前任务类型。
- `requires_project_context`
  - 是否需要当前项目/代码/文件上下文。
- `needs_tools`
  - 是否可能需要工具。
- `suggested_tools`
  - Router 建议开放的工具。
- `tool_reason`
  - 为什么需要工具。
- `confidence`
  - Router 对判断的置信度。

后续实现方向：

- 修改 `packages/memorizes/intent/01-parser.md`，让 Ollama 输出完整 Router schema。
- 修改 `ollamaIntentProvider.ts` 的解析和校验逻辑。
- Core 根据 Router 输出做 tool selection、task state 更新和上下文构建。

## 2026-05-17 Router 验收问题方向

用户观察当前主流 Agent 做法后提出：意图识别阶段可能还需要增加“问题”，形成“意图 + 问题 + 类型”的组合。其中“问题”用于大模型返回后的校验。

设计判断：

- 这个方向成立。
- 这里的“问题”不应理解为向用户追问的问题，而应理解为后处理管线的验收问题。
- Router 不只是判断用户想干什么，还要产出本轮执行完成后如何判断“做对了没有”。

建议字段：

```json
{
  "intent": "analysis",
  "task_type": "design",
  "rewritten_input": "用户想确认 Router 是否需要增加用于后处理校验的问题字段。",
  "verification_question": "大模型回复是否清楚解释了该字段的作用、和 intent/task_type 的区别，以及它在后处理管线中的使用方式？",
  "success_criteria": [
    "解释问题字段不是用户追问，而是验收问题",
    "说明它用于输出后校验",
    "说明通过/失败后的下一步动作"
  ],
  "needs_user_clarification": false,
  "clarifying_questions": []
}
```

后处理用途：

- 大模型回复完成后，把 `verification_question`、`success_criteria`、模型回复和任务状态交给后处理 evaluator。
- evaluator 判断：
  - 是否回答了用户真实问题。
  - 是否满足任务目标。
  - 是否需要继续调用工具。
  - 是否需要再让大模型补充一轮。
  - 是否需要向用户提问。

与现有字段区别：

- `intent`
  - 用户这句话的大方向。
- `task_type`
  - 要进入哪类任务流程。
- `verification_question`
  - 完成后用什么问题检查结果是否合格。
- `clarifying_questions`
  - 只有信息不足时才给用户看的追问。

当前状态：

- 已记录设计方向。
- 已在下一节完成 Router schema 和后处理 evaluator 第一版实现。

## 2026-05-17 Output Evaluator 第一版实现

用户确认希望按“意图 + 类型 + 验收问题/成功条件”改造当前链路，并启用大模型输出后的校验步骤。

已完成：

- `packages/shared/src/index.ts` 扩展 `RouterResult`：
  - `verification_question`
  - `success_criteria`
  - `needs_user_clarification`
  - `clarifying_questions`
- 新增 `OutputEvaluationResult`：
  - `should_evaluate`
  - `passed`
  - `satisfied_criteria`
  - `missing_criteria`
  - `issues`
  - `next_action`
  - `revision_instruction`
  - `confidence`
- `AgentEventType` 新增：
  - `output_evaluation`
- `packages/memorizes/intent/01-parser.md` 更新 Router 输出格式和示例。
- 新增 Evaluator Prompt：
  - `packages/memorizes/evaluator/01-system.md`
  - `packages/memorizes/evaluator/02-input.md`
- 新增 Provider：
  - `packages/core/src/providers/outputEvaluatorProvider.ts`
- `prompts.ts` 新增：
  - `buildEvaluatorSystemPrompt`
  - `buildEvaluatorUserPrompt`
- `events.ts` 新增：
  - `saveOutputEvaluationEvent`

执行流程：

1. 用户输入。
2. Router 小模型输出 intent、task_type、verification_question、success_criteria 等字段。
3. Core 选择工具并构建上下文。
4. 大模型流式回复。
5. 如有工具调用，先执行工具并进行工具结果整理。
6. 如果是任务型输入且存在验收问题/成功条件，调用 Output Evaluator。
7. Evaluator 通过：
   - 直接保存最终回复。
8. Evaluator 返回 `revise_answer`：
   - 追加一次大模型补充修正。
   - 不递归再验收，避免无限循环。
9. Evaluator 返回 `ask_user` 或 `use_tools`：
   - 第一版先在最终回复末尾追加系统提示。
   - 不自动进入新工具循环。
10. Evaluator 自身失败：
   - 记录 `error` event，stage 为 `输出验收`。
   - 不丢弃已经生成的大模型回复，直接返回原内容。

当前边界：

- Evaluator 复用 `router` 模型配置，不新增第四类模型配置。
- 普通聊天和非任务输入不触发输出验收。
- 第一版最多补充修正一轮。
- `use_tools` 的二次工具循环暂不做，后续等完整 ReAct/任务状态系统更稳后再扩展。

验证：

- `corepack pnpm --filter @xiaomi/desktop typecheck` 成功。
- 确认新增代码未使用 `yield`、`async function*`、`for await`。
- `corepack pnpm build` 成功。

## 2026-05-16 Router 与 SQLite 关键决策

用户确认三个关键决策：

1. Router 置信度阈值
   - 使用 `0.7`。
   - `confidence >= 0.7` 时，Core 可以按 Router 建议进行较自动化的工具开放和任务创建。
   - `confidence < 0.7` 时，Core 采取保守策略。
2. `suggested_tools`
   - 保留扩展设计。
   - 第一版主要支持 `command.run`。
   - 未来可扩展：
     - `web.search`
     - `memory.search`
     - `project.updateTask`
3. SQLite 依赖选型
   - Node/Electron 使用 `better-sqlite3`。
   - 适合本地桌面应用、同步 API 简单、性能好。

## 2026-05-16 Agent Trace 观察层方向

用户希望整个项目对人类友好，能够很好地观察各个环节、提示词和返回。

设计目标：

- 不只是查看模型 API 请求和返回。
- 要能观察每轮 agent 的完整链路。
- 让用户能知道：
  - Router 为什么这么判断。
  - Core 为什么开放这些工具。
  - 上下文最终是怎么组装的。
  - 模型请求和返回是什么。
  - 工具调用和工具结果是什么。
  - 任务状态如何变化。

建议调试面板视图：

- `Trace`
  - 时间线展示完整 agent 步骤。
- `Prompts`
  - 展示 System Prompt modules、Router Prompt modules、Tool Prompt modules、Runtime Context、最终 messages。
- `Models`
  - 展示 Ollama Router、MiMo Main 的请求、响应、stopReason、usage、duration。
- `Tools`
  - 展示 command.run、decision、cwd、command、stdout/stderr、exitCode、duration。
- `State`
  - 展示 focusedTask、activeTasks、turnState、toolStepCount、routerResult、selectedTools。
- `Raw`
  - 展示完整 JSON，便于开发调试。

建议数据结构：

```ts
interface AgentTrace {
  id: string
  sessionId: string
  turnId: string
  projectId: string
  startedAt: string
  completedAt?: string
  steps: TraceStep[]
}

interface TraceStep {
  id: string
  type: string
  label: string
  status: "pending" | "running" | "succeeded" | "failed"
  input?: unknown
  output?: unknown
  startedAt: string
  completedAt?: string
  durationMs?: number
}
```

Step 类型建议：

- `user_input`
- `router_request`
- `router_response`
- `core_policy`
- `context_build`
- `model_request`
- `model_response`
- `tool_call`
- `tool_result`
- `task_update`
- `final_response`
- `error`

实现策略：

- 第一版可先内存保存最近 20 条 trace。
- 后续写入 SQLite：
  - `agent_traces`
  - `trace_steps`

## 2026-05-17 调试面板 Trace 视图改造

用户反馈当前调试工具太难使用，很难看懂。

问题判断：

- 原调试面板主要是“模型请求列表”和“事件链列表”。
- 对开发者来说信息完整，但对人类观察 Agent 行为不友好。
- 用户需要先看懂“这一轮 Agent 到底发生了什么”，再按需展开原始 JSON。

已完成：

- 调试抽屉默认 Tab 改为 `Trace`。
- Tab 结构调整为：
  - `Trace`
  - `模型请求`
  - `事件链`
- 新增 Trace 总览：
  - 步骤数。
  - 模型请求数。
  - 事件数。
- 新增 Trace 步骤时间线：
  - 用户输入。
  - Router 意图识别。
  - Core 工具策略。
  - 主模型回复。
  - 工具执行。
  - 输出验收。
  - 最终回复。
- 每个步骤展示：
  - 中文标题。
  - 状态 Badge。
  - 简短摘要。
  - 关键字段。
  - 可折叠原始数据。
- 原始模型请求和原始事件仍保留在次级 Tab 中，但默认不展开大段 JSON。

涉及文件：

- `apps/desktop/src/ui/MinimalChatPage.tsx`
- `apps/desktop/src/styles.css`

当前限制：

- Trace 仍由前端根据 `events` 和 `providerDebugLogs` 聚合生成，不是后端独立 `AgentTrace` 表。
- 当前展示的是当前 session 最近事件，不是严格按 turnId 分组。
- 后续可引入 `turnId` / `trace_steps` 后再做更精确的多轮 Trace。

验证：

- `corepack pnpm --filter @xiaomi/desktop typecheck` 成功。
- `corepack pnpm build` 成功。

## 2026-05-17 调试面板 Trace 主入口收敛

用户继续反馈：虽然 Trace 好了很多，但不理解最外层为什么是 `Trace / 模型请求 / 事件链` 三个组合。

设计判断：

- `Trace`、`模型请求`、`事件链` 不是同一层业务概念。
- `Trace` 是人类可读主视图。
- `模型请求` 和 `事件链` 是原始数据，应作为 Trace 步骤的展开详情，而不是外层平级入口。

已完成：

- 移除调试抽屉外层 Tab。
- 删除 `debugTab` 状态。
- 删除外层 `模型请求` 和 `事件链` 列表入口。
- Trace 成为调试面板唯一主入口。
- 每个 Trace 步骤保留：
  - 中文标题。
  - 状态。
  - 摘要。
  - 关键字段。
  - 原始事件数据。
  - 关联模型请求。
  - 关联模型响应或错误。
- Router、主模型、Evaluator 步骤会把对应模型请求/响应嵌入到步骤详情中。

当前结构：

```text
调试面板
└─ Trace
   ├─ 用户输入
   ├─ Router 意图识别
   │  ├─ router_result event
   │  └─ Router 模型请求/响应
   ├─ Core 工具策略
   ├─ 主模型回复
   │  ├─ model_return event
   │  └─ Main 模型请求/响应
   ├─ 工具执行
   ├─ 输出验收
   │  ├─ output_evaluation event
   │  └─ Evaluator 模型请求/响应
   └─ 最终回复
```

涉及文件：

- `apps/desktop/src/ui/MinimalChatPage.tsx`
- `apps/desktop/src/styles.css`

验证：

- `corepack pnpm --filter @xiaomi/desktop typecheck` 成功。
- `corepack pnpm build` 成功。

## 2026-05-17 Trace 回合选择器

用户反馈：第二次对话时，无法在调试面板精准看到前一次对话。

问题判断：

- 这不是故意设计。
- 当前 SQLite events 只有 `session_id`，没有 `turn_id`。
- ProviderDebugLog 也没有 `session_id` / `turn_id`。
- 多轮对话后，Trace 只能看整个 session 的事件，导致前一轮和后一轮混在一起。

本次前端修复：

- 在 `MinimalChatPage.tsx` 中按 `chat_message(actor=user)` 将当前 session 的事件切分为多个回合。
- 新增“第 N 轮”回合选择器。
- 默认选择最新一轮。
- 选择某一轮后：
  - Trace 只展示该用户输入到下一次用户输入之前的事件。
  - ProviderDebugLog 暂按时间窗口匹配到该轮。
- 当前回合的 Trace 步骤、模型请求数、事件数都会跟随选择变化。

涉及文件：

- `apps/desktop/src/ui/MinimalChatPage.tsx`
- `apps/desktop/src/styles.css`

当前限制：

- 这是前端轻量切分，不是严格后端 trace。
- ProviderDebugLog 通过时间窗口匹配回合，极端情况下可能不完全准确。
- 后续应在 ChatService 每轮生成 `turnId`，并写入：
  - `events`
  - `ProviderDebugLog`
  - `tool_call`
  - `tool_result`
  - `model_return`
  - `output_evaluation`

验证：

- `corepack pnpm --filter @xiaomi/desktop typecheck` 成功。
- `corepack pnpm build` 成功。

## 2026-05-17 模型请求详情人类可读化

用户反馈：Trace 中请求详情仍然出现大量 `\n`、转义引号和嵌套 JSON 字符串，例如 `next_action`、`revision_instruction` 等字段看起来很难读。

问题判断：

- 原实现直接对整个 `request.body` 做 `JSON.stringify`。
- 当 request body 里包含 prompt、messages 或 JSON 字符串时，会出现大量转义字符。
- 这种格式适合机器存档，不适合作为默认的人类调试视图。

已完成：

- `modelLogDetails` 默认展示“模型请求”易读格式。
- 请求详情按以下结构展示：
  - provider。
  - status。
  - method。
  - endpoint。
  - model。
  - baseURL。
  - duration。
  - temperature。
  - max_tokens。
  - stream。
  - options。
  - system。
  - messages。
- `messages` 按 `#序号 role=...` 分块展示。
- message content 按原文显示，不再作为 JSON 字符串二次转义。
- 仍保留“原始请求 JSON”展开项，供高级排查使用。

涉及文件：

- `apps/desktop/src/ui/MinimalChatPage.tsx`

验证：

- `corepack pnpm --filter @xiaomi/desktop typecheck` 成功。
- `corepack pnpm build` 成功。

## 2026-05-17 对话与调试交互细节修复

用户发现两个交互问题：

- 接口调试中的回合选择应倒序显示。
- 对话框显示不会自动滚动到底。

已完成：

- `MinimalChatPage` 引入 `useRef` / `useEffect`。
- 消息区末尾增加滚动锚点。
- 当 `messages`、`stageLabel` 或 `error` 变化时，自动 `scrollIntoView` 到底部。
- Trace 回合选择器改为倒序显示。
- 最新一轮显示在最上方。
- 回合按钮仍保留真实轮次编号，例如“第 3 轮”不会因为倒序显示变成“第 1 轮”。

涉及文件：

- `apps/desktop/src/ui/MinimalChatPage.tsx`

验证：

- `corepack pnpm --filter @xiaomi/desktop typecheck` 成功。
- `corepack pnpm build` 成功。

## 2026-05-17 Trace 关键字段摘要与自动刷新

用户反馈：Trace 比之前好很多，但仍感觉难用，主要问题有两个：

- 默认没有展示用户真正关心的字段。
- 第二次对话后需要手动刷新，调试面板才出现新一轮。

调整方向：

- Trace 不只展示步骤列表，还需要先给“本轮关键信息”。
- 新一轮流式完成后，应自动刷新当前完成的 session，并选中最新回合。

已完成：

- 新增 `TraceHighlight` 摘要模型。
- Trace 面板新增“本轮关键信息”区。
- 摘要区默认展示：
  - 用户输入。
  - 意图和任务类型。
  - 任务目标。
  - Router 置信度。
  - 工具建议 / 已开放工具 / 权限模式。
  - 主模型、stopReason、耗时。
  - 输出验收结果。
  - 错误信息。
- 摘要项按状态做轻量提示：
  - 通过 / 成功使用绿色。
  - 低置信度、max_tokens、未通过验收使用黄色。
  - 错误使用红色。
- `sendMessage` 在监听流式事件时记录 `done` 事件中的真实 `sessionId`。
- 主调用完成后使用该 `sessionId` 刷新调试数据。
- `refreshSessionEvents` 支持 `selectLatest`，新回合完成后自动选择最新回合。
- 手动刷新时优先保留用户当前选择的回合；如果该回合不存在，则回退到最新回合。

涉及文件：

- `apps/desktop/src/ui/MinimalChatPage.tsx`
- `apps/desktop/src/styles.css`

验证：

- `corepack pnpm --filter @xiaomi/desktop typecheck` 成功。
- `corepack pnpm build` 成功。

## 2026-05-17 调试观察对象重新分层

用户进一步明确：当前调试面板的问题不是单纯缺几个字段，而是展示对象不够直观。

用户真正关心两类信息：

- 各个节点的产出：
  - Router 产出了什么。
  - Core 工具策略产出了什么。
  - 上下文构建产出了什么。
  - 主模型产出了什么。
  - 工具执行产出了什么。
  - 输出验收产出了什么。
- 输出信息：
  - 发给小模型的请求。
  - 发给大模型的上下文和 messages。
  - 发给工具的命令或参数。
  - 工具返回给模型的结果。
  - 最终展示给用户的回复。

由此得到新的观察层设计方向：

- 调试面板不应只是一条线性 Trace。
- 应拆成两个互补视角：
  - `节点产物视图`：按 Agent 节点看每一步的输入、输出、状态和关键产物。
  - `信息流视图`：按信息如何流动，看 user input -> router input/output -> context package -> model request/response -> tool input/output -> final answer。
- 线性 Trace 仍可保留，但应降级为时间线或审计明细，不再承担全部理解任务。

第一版可做的 UI 调整：

- 每个节点做成清晰的产物卡片。
- 卡片顶部展示节点名、状态、耗时。
- 卡片主体直接展示该节点的核心产出。
- 卡片底部提供“输入 / 输出 / 原始 JSON”切换或展开。
- 右侧或下方增加“本轮输出信息”区，专门展示最终传递出去的信息包。

## 2026-05-17 节点产物与输出信息 UI 试验版

基于上面的观察层分层，先做一个前端聚合试验版，不改变后端事件结构。

已完成：

- Trace 主视图继续保留回合选择、摘要和本轮关键信息。
- 新增“节点产物”区：
  - `Router`：展示意图识别产物、intent、taskType、confidence、success criteria。
  - `Core`：展示工具策略产物、开放工具、权限模式、autoAllowed。
  - `Context`：展示大模型输入产物、provider、model、message count，并可展开大模型请求。
  - `Model`：展示主模型产物、stopReason、耗时、状态，并可展开请求/响应。
  - `Tools`：展示工具调用和工具结果数量。
  - `Evaluator`：展示输出验收产物、nextAction、confidence、missing criteria。
  - `Output`：展示最终回复产物。
- 新增“输出信息”区：
  - `User -> Router`：用户输入进入意图识别。
  - `Core -> 小模型`：Router 请求。
  - `Router -> Core`：Router 返回结构化结果。
  - `Core -> Model`：本轮工具开放信息。
  - `Core -> 大模型`：大模型上下文包。
  - `大模型 -> Core`：大模型返回。
  - `Core -> Tools`：工具输入与输出。
  - `Core -> Evaluator`：输出验收请求/返回。
  - `Core -> User`：最终展示给用户。
- 原线性 Trace 时间线保留，但收进“时间线明细”折叠区，作为审计明细使用。
- 新增轻量状态颜色：
  - 绿色：完成/通过。
  - 黄色：低置信度、max_tokens、需要修正。
  - 红色：失败/错误。
  - 低透明度：跳过。

涉及文件：

- `apps/desktop/src/ui/MinimalChatPage.tsx`
- `apps/desktop/src/styles.css`

验证：

- `corepack pnpm --filter @xiaomi/desktop typecheck` 成功。
- `corepack pnpm build` 成功。

## 2026-05-17 提示词观察区

用户继续明确一个核心关注点：提示词需要非常直观地展示，因为后续会做动态规划提示词。

设计判断：

- 提示词不应只藏在模型请求 JSON 里。
- 提示词应该成为调试面板的一等观察对象。
- 第一版先展示“最终拼装后的提示词”。
- 后续动态规划提示词时，再扩展为：
  - 模板名。
  - 模板版本。
  - 输入变量。
  - 渲染结果。
  - 规划链路。
  - 不同版本提示词差异。

已完成：

- 调试面板新增“提示词”区。
- 按模型调用阶段展示提示词卡片：
  - `Router 提示词`。
  - `主模型提示词`。
  - `Evaluator 提示词`。
- 每张卡片展示：
  - providerId。
  - model。
  - status。
  - message count。
  - temperature。
  - max_tokens / num_predict。
  - stream。
  - System 内容。
  - messages 列表，按 role 展示。
  - 完整提示词请求。
- 目前数据来源仍是 `ProviderDebugLog.request.body`，即真实发送给模型的最终请求。
- 这保证 UI 展示的是“模型实际收到的提示词”，不是理想化模板。

后续修正：

- 用户发现提示词没有显示完整。
- 去掉 `System` 和单条 `message` 的前端截断。
- `System` 改为完整文本展示，区域内部最大高度 `260px`，超过后滚动。
- 单条 `message` 改为完整文本展示，区域内部最大高度 `220px`，超过后滚动。
- 保留“完整提示词请求”展开项，用于查看完整模型请求。

模板增强：

- 用户认为除了最终提示词，还应该展示类似“模板”的稳定结构。
- 第一版在提示词卡片中新增“模板”区。
- 每张提示词卡片展示：
  - 模板名称。
  - 模板版本。
  - 变量槽位。
  - 模板模块文件。
- 当前模板信息为前端按调用阶段静态标注：
  - `router.intent.v1`
  - `main.agent.v1`
  - `output.evaluator.v1`
- 这样可以同时看到：
  - 稳定模板结构。
  - 本次最终渲染后的提示词。
  - 实际发送给模型的完整请求。
- 后续更完整的做法：
  - 由后端 Prompt Builder 返回模板元数据。
  - ProviderDebugLog 记录 templateName、templateVersion、moduleFiles、variables、renderedMessages。
  - UI 支持模板版本差异和变量值追踪。

实际提示词流程增强：

- 用户指出：提示词观察区能看到模板信息，但真实提示词里还没有增加“按步骤思考/流程”和结构化模板字段。
- 已将流程要求写入真实 Markdown 模板，而不是只在 UI 中标注。
- Router 模板增强：
  - 输出 JSON 新增 `reasoning_brief`。
  - 输出 JSON 新增 `planned_steps`。
  - 输出 JSON 新增 `expected_output`。
  - 示例同步更新。
- 主模型 System 模板增强：
  - 新增“工作流程模板”。
  - 要求内部按以下流程推进：
    - 理解目标。
    - 选择路径。
    - 拆分步骤。
    - 执行或说明。
    - 输出结果。
  - 明确不要把完整内部思考过程原样输出给用户。
  - 复杂任务可以简短展示“本轮做了什么 / 结果是什么 / 下一步是什么”。
  - 简单聊天不要机械列步骤。
- Evaluator 模板增强：
  - 输出 JSON 新增 `check_steps`。
  - 输出 JSON 新增 `decision_reason`。
  - 要求按 `success_criteria` 逐项检查后再决定 `next_action`。
- 类型与解析同步：
  - `RouterResult` 增加 `reasoning_brief`、`planned_steps`、`expected_output`。
  - `OutputEvaluationResult` 增加 `check_steps`、`decision_reason`。
  - Router Provider 解析这些字段。
  - Output Evaluator Provider 解析这些字段。
- 调试面板同步：
  - 本轮关键信息展示 Router `planned_steps`。
  - Router 节点产物展示步骤和期望产出。
  - Evaluator 节点产物展示检查步骤和判断原因。

可见处理过程修正：

- 用户继续指出：主模型提示词中没有明确要求模型“显示思考的过程”。
- 设计上不直接要求输出完整内部思考链条，而是要求输出“可见处理过程”。
- 已在主模型 System Prompt 中明确：
  - 复杂任务、工具调用、项目实现、调试验证或持续推进时，回复中必须展示简短的可见处理过程。
  - 可见处理过程包含：
    - `目标理解`
    - `处理步骤`
    - `本轮结果`
    - `下一步`
  - 可见处理过程要短，不要写成长篇推理。
  - 不要输出完整内部思考链条、隐藏推理、逐 token 推理或不确定的脑内草稿。
  - 简单聊天、寒暄或非常简单的问题不要机械套模板。

涉及文件：

- `apps/desktop/src/ui/MinimalChatPage.tsx`
- `apps/desktop/src/styles.css`
- `packages/shared/src/index.ts`
- `packages/core/src/providers/ollamaIntentProvider.ts`
- `packages/core/src/providers/outputEvaluatorProvider.ts`
- `packages/memorizes/intent/01-parser.md`
- `packages/memorizes/system/02-goals.md`
- `packages/memorizes/evaluator/01-system.md`

验证：

- `corepack pnpm --filter @xiaomi/desktop typecheck` 成功。
- `corepack pnpm build` 成功。

## 2026-05-17 输出验收展示语义修正

用户发现调试面板里“输出验收产物”显示“未通过”时不容易理解。

问题原因：

- 后端 Evaluator 的 `passed=false` 不一定表示系统失败。
- 它也可能表示后处理管线认为还需要继续动作：
  - 让大模型补充。
  - 继续调用工具。
  - 向用户追问。
- 原 UI 把 `passed=false` 统一渲染成“未通过”和失败状态，语义太重。

已完成：

- 新增 `evaluationDisplayFromPayload`。
- 输出验收展示从二元状态改为动作状态：
  - `passed=true` -> `通过`。
  - `next_action=revise_answer` -> `需修正`。
  - `next_action=use_tools` -> `需工具`。
  - `next_action=ask_user` -> `需追问`。
  - `next_action=final` 且 `passed=false` -> `可放行`。
  - 未知动作 -> `需确认`。
- `输出验收`摘要、`节点产物`、`输出信息`和`时间线明细`统一使用新的展示语义。
- `passed=false` 不再直接等于 UI 失败。
- 只有真正错误事件或模型调用错误才应按失败理解。

验证：

- `corepack pnpm --filter @xiaomi/desktop typecheck` 成功。
- `corepack pnpm build` 成功。

## 2026-05-17 长期记忆与提示词自动迭代第一版

用户希望开始增加长期记忆和提示词自动迭代能力。

设计边界：

- 长期记忆第一版使用 SQLite，不使用 Markdown 作为主存储。
- 第一版不做向量检索，先做结构化字段 + 关键词/重要性召回。
- 记忆捕获保持保守，只在用户表达明确长期信号时写入。
- 提示词自动迭代第一版只生成候选建议，不自动改 Markdown 模板。
- 自动改模板需要后续加入人工确认、版本差异和回滚机制后再做。

长期记忆已完成：

- SQLite 新增 `memories` 表。
- 新增共享类型 `MemoryRecord` 和 `MemoryType`。
- 新增 Core 模块 `longTermMemories.ts`。
- 支持：
  - `captureLongTermMemories`
  - `saveMemory`
  - `listRelevantMemories`
- 当前捕获信号包括：
  - `记住`
  - `记录`
  - `长期`
  - `以后`
  - `后续`
  - `我希望`
  - `我偏好`
  - `我不希望`
  - `不要`
  - `规则`
  - `系统规则`
  - `决定`
  - `确认`
- 记忆类型：
  - `fact`
  - `preference`
  - `decision`
  - `plan`
  - `constraint`
- 每条记忆保存：
  - projectId
  - type
  - content
  - tags
  - importance
  - confidence
  - sourceSessionId
  - sourceEventIds
  - status
- ChatService 在 Router 后：
  - 捕获可长期保存的用户输入。
  - 写入 `memory_write` event。
  - 按当前用户输入、Router rewrite、keywords、task_goal 召回相关长期记忆。
  - 写入 `memory_recall` event。
  - 将召回记忆注入主模型上下文。
- 主模型收到的长期记忆上下文会标明：
  - 这是本地长期记忆召回。
  - 不是用户本轮新输入。
  - 高重要性规则应优先遵守。
  - 不要原样复述。

提示词自动迭代已完成：

- SQLite 新增 `prompt_iterations` 表。
- 新增共享类型 `PromptIterationRecord`。
- 新增 Core 模块 `promptIterations.ts`。
- 支持：
  - `savePromptIteration`
  - `listPromptIterations`
- 当 Output Evaluator 返回非 `passed` 且 `next_action` 不是 `final` 时，生成提示词迭代候选。
- 候选记录包括：
  - targetTemplate
  - trigger
  - reason
  - suggestedChange
  - sourceEventIds
  - status
- 当前 targetTemplate 规则：
  - `next_action=use_tools` 时优先建议检查 `main.agent.v1`。
  - 其他验收缺口优先建议检查 `output.evaluator.v1`。
- 写入 `prompt_iteration` event。
- 当前不自动修改 `packages/memorizes/**/*.md`。

调试面板已完成：

- 节点产物新增 `Memory` 节点。
  - 展示写入数量。
  - 展示召回数量。
  - 可展开查看写入/召回 JSON。
- 节点产物新增 `Prompt` 节点。
  - 展示提示词迭代候选。
  - 展示 targetTemplate 和 trigger。
  - 可展开查看候选 JSON。

涉及文件：

- `packages/shared/src/index.ts`
- `packages/core/src/storage/database.ts`
- `packages/core/src/longTermMemories.ts`
- `packages/core/src/promptIterations.ts`
- `packages/core/src/events.ts`
- `packages/core/src/chatService.ts`
- `packages/core/src/providers/mimoProvider.ts`
- `packages/core/src/index.ts`
- `apps/desktop/src/ui/MinimalChatPage.tsx`
- `PROJECT_MEMORY.zh-CN.md`
- `docs/IMPLEMENTATION_STATUS.zh-CN.md`

验证：

- `corepack pnpm --filter @xiaomi/desktop typecheck` 成功。
- `corepack pnpm build` 成功。

## 2026-05-16 多 Agent 协作第一版确认

用户确认多 Agent 协作第一版按当前建议推进。

核心角色：

- `project`
  - 项目协调者。
  - 用户输入/输出口。
  - 拆任务、分配角色、收集结果、决定下一步、最终汇总。
- `product`
  - 产品视角。
  - 负责需求、用户目标、边界、验收标准。
- `tech`
  - 技术方案视角。
  - 负责架构、模块、风险、技术选型。
- `developer`
  - 开发实现视角。
  - 负责代码实现、修改、运行验证。
- `tester`
  - 测试验证视角。
  - 负责测试策略、构建验证、问题复现。

协作规则：

- `project agent` 作为 coordinator。
- 其他 agent 第一版不直接对用户说话。
- 其他 agent 第一版不互相自由对话。
- agent 之间通过 `agent_runs` 针对 task 交付结构化结果。
- coordinator 收集并汇总 agent run 结果。

执行方式：

- 第一版串行执行。
- 暂不做并行 agent runs。
- 每个 agent 使用独立 prompt。
- 第一版共用 MiMo 模型。
- 工具调用由 Core / Command Gateway 控制。
- UI 通过 Agent Trace 展示各 agent run。

后续扩展：

- 支持设计、视频、音频、研究、运维等更多角色。
- 支持并行 agent runs。
- 支持不同 agent 绑定不同模型。
- 支持 agent 间受控通信。

### 下一步建议

1. 接入真实模型 Provider 抽象。
2. 将角色定义改为可配置文件。
3. 实现工作流保存和加载。
4. 增加节点运行实时事件。
5. 增加 Artifact 保存。
6. 增加只读文件工具和权限确认。

## 2026-05-17 本地语义工具第一版

工具系统已从单一 `command.run` 扩展为“语义化本地工具 + 命令兜底”的 Tool Gateway。

新增工具：

- `file.read`
  - 读取工作区内文本文件。
  - 支持 `path` 和 `maxBytes`。
- `file.list`
  - 列出工作区内目录。
  - 支持 `recursive` 和 `maxEntries`。
- `file.search`
  - 在工作区内搜索文本。
  - 支持 `path`、`query`、`glob`、`maxResults`。
- `file.write`
  - 在工作区内写入文件。
  - 需要 `project_write` 权限。
  - 单次写入限制约 300KB。
- `memory.save`
  - 将模型认为需要长期保存的信息写入 SQLite 长期记忆。
  - 支持 `memoryType`、`tags`、`importance`。
- `command.run`
  - 保留作为复杂 PowerShell、构建、测试、验证命令的兜底工具。

执行规则：

- 所有文件工具路径必须位于当前工作区内。
- 读/列目录/搜索工具在 `project_read`、`project_verify`、`project_write` 下可用。
- 读/列目录/搜索工具按低风险处理：只要本轮涉及项目上下文、需要工具或 Router 建议读取工具，即使 Router 置信度低于 0.7，也会以 `project_read` 模式开放。
- 已修正策略顺序：当 Router 返回 `requires_project_context=true`，但 `needs_tools=false` 且 `suggested_tools=[]` 时，仍开放 `file.read`、`file.list`、`file.search`，避免模型需要读取项目时被 Core 拒绝。
- 最新策略：读取权限彻底放开。`file.read`、`file.list`、`file.search` 在 Tool Gateway 层默认允许执行，不再依赖本轮 `tool_selection.selected_tools` 或 Router 是否开放工具。
- 敏感文件保护：
  - 拒绝读取/写入 `.env`、`secrets.local.json`、`model-runtime.local.json`、`agent.db`、证书、密钥、数据库文件。
  - 拒绝路径中包含 `secret`、`token`、`apikey`、`api-key`、`credential` 的文件。
  - 拒绝 `.ssh` 等敏感路径。
  - `file.search` 和递归 `file.list` 会跳过敏感文件。
- 管理员 Agent 权限模式：
  - Tool Selection Policy 默认开放全部本地工具：`file.read`、`file.list`、`file.search`、`file.write`、`memory.save`、`command.run`。
  - 默认 `access_mode=project_write`。
  - Tool Gateway 对写入、记忆、命令请求默认放行。
  - Command Gateway 不再根据本轮工具开放、读/验证/写权限、危险模式、安装依赖、git 操作等规则拦截 PowerShell 命令。
  - 敏感文件允许读取、列目录和搜索。
  - 敏感文件写入保护仍保留。
  - 删除/清理类命令不会执行，会返回 `decision=confirm`、`status=skipped`，工具结果 `reason` 包含“删除确认”，等待用户确认。
- `project_read` 只开放 `file.read`、`file.list`、`file.search`。
- `file.write` 仅在 `project_write` 下自动执行。
- `command.run` 仍走原 Command Gateway 安全策略。
- 每轮最多解析和执行 8 个工具请求。
- 工具执行结果统一写入 `tool_call` / `tool_result` events，并在工具结果整理阶段再次交给主模型生成最终回复。

提示词更新：

- Router 可建议 `file.read`、`file.list`、`file.search`、`file.write`、`memory.save`、`command.run`。
- 主模型上下文提示要求优先使用语义化工具，复杂命令、构建、测试再使用 `command.run`。
- 工具请求示例已更新为多工具格式。

MiMo thinking / 原生工具兼容性注意：

- 默认工具系统仍不是 MiMo/OpenAI/Anthropic 原生 function calling，而是文本 JSON 工具请求 + Tool Gateway。
- 新增兼容模式 `toolCallingMode=native-openai`，仅在主模型为 OpenAI-compatible 时生效。
- 新增配置 `thinkingEnabled`。开启后，OpenAI-compatible 请求会携带 `thinking: { type: "enabled" }`。
- Native OpenAI 模式会：
  - 向 `/chat/completions` 传 `tools`。
  - 接收 assistant 原生 `reasoning_content`、`content`、`tool_calls`。
  - 将 function tool call 映射到本地 `file.read`、`file.list`、`file.search`、`file.write`、`memory.save`、`command.run`。
  - 执行 Tool Gateway。
  - 追加 `role=tool`、`tool_call_id`、`content` 后继续请求模型。
  - 最多执行 8 个工具请求。
- 为避免 MiMo 多轮 400，最终助手消息会在 `metadata.openaiNativeMessages` 保存完整原生消息链，后续 OpenAI-compatible 请求会展开回传，而不是只回传可见 `content`。
- Anthropic-compatible 原生 tools 尚未实现，仍走文本 JSON 工具协议。
- 当前本地主模型配置已切换为 MiMo OpenAI 原生工具模式：
  - `providerKind=openai-compatible`
  - `baseURL=https://api.xiaomimimo.com/v1`
  - `model=mimo-v2.5-pro`
  - `toolCallingMode=native-openai`
  - `thinkingEnabled=true`
- 模型配置 UI 已新增“使用 MiMo 原生工具”按钮。
- 主模型配置项已联动防误操作：
  - 只有主模型且 Provider 为 OpenAI Compatible 时，才能选择 Native OpenAI。
  - 选择 Native OpenAI 会自动开启 Thinking。
  - 关闭 Thinking 会自动切回 Text JSON。
  - 切换到 Ollama 或 Anthropic Compatible 会自动关闭 Native OpenAI 和 Thinking。
- Core 配置归一化也会兜底防止手写 JSON 出现不兼容组合。
- UI 已增加模型思考与正式产出的视觉区分：
  - 聊天区助手消息会按“正式回复”“工具结果整理”“补充修正”“系统提示”分块展示。
  - 调试区会解析 MiMo 原生响应中的 `reasoning_content`、`tool_calls`、`content`。
  - 原生响应分别展示为“模型思考 reasoning_content”“工具调用 tool_calls”“正式产出 content”和“完整模型响应”。
  - Trace 摘要优先展示正式产出和工具调用摘要，不再默认把 reasoning JSON 当作主模型产出。

涉及文件：

- `packages/shared/src/index.ts`
- `packages/core/src/toolCallParser.ts`
- `packages/core/src/localToolGateway.ts`
- `packages/core/src/toolSelectionPolicy.ts`
- `packages/core/src/chatService.ts`
- `packages/core/src/events.ts`
- `packages/core/src/providers/ollamaIntentProvider.ts`
- `packages/memorizes/context/intent-result.md`
- `packages/memorizes/intent/01-parser.md`
