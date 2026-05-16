# 项目记忆

这个文件记录不应该只存在于对话中的长期项目上下文。

## 协作规则

- 对话中出现的关键信息需要记录到本地，尤其是项目决策、用户偏好、架构约束和项目方向，避免只存在聊天上下文里。
- 这个 AI Agent 项目仍处于萌芽阶段，目标是搭建一个适合用户个人工作流和长期需求的 Agent 项目，而不是通用模板。
- 用户希望 Codex 生成并维护相关 Skill 和项目背景描述，并一起把项目从头到尾搭建起来。
- 中文也需要记录。重要的项目记忆、用户偏好、决策和背景说明，应优先写入中文文件，而不是只写英文。
- 多语言内容应该拆分到独立文件中维护，避免在同一份长期文档里中英混排。

## 项目文档

- `PROJECT_MEMORY.md` 是项目记忆索引。
- `PROJECT_MEMORY.zh-CN.md` 是中文项目记忆。
- `PROJECT_MEMORY.en-US.md` 是英文项目记忆。
- `docs/PROJECT_BACKGROUND.md` 是项目背景索引。
- `docs/PROJECT_BACKGROUND.zh-CN.md` 是中文项目背景。
- `docs/PROJECT_BACKGROUND.en-US.md` 是英文项目背景。
- `docs/AGENT_BUILD_ROADMAP.md` 是个人 Agent 搭建路线图索引。
- `docs/AGENT_BUILD_ROADMAP.zh-CN.md` 是中文个人 Agent 搭建路线图。
- `docs/MULTI_ROLE_COLLABORATION_MODEL.md` 是多角色协作体模型索引。
- `docs/MULTI_ROLE_COLLABORATION_MODEL.zh-CN.md` 是中文多角色协作体模型设计。
- `docs/TECH_STACK_DECISION.md` 是技术选型决策索引。
- `docs/TECH_STACK_DECISION.zh-CN.md` 是中文技术选型决策。
- `docs/ELECTRON_AGENT_WORKBENCH_REQUIREMENTS.md` 是 Electron Agent 工作台需求索引。
- `docs/ELECTRON_AGENT_WORKBENCH_REQUIREMENTS.zh-CN.md` 是中文 Electron Agent 工作台需求草案。
- `docs/IMPLEMENTATION_STATUS.md` 是实现状态索引。
- `docs/IMPLEMENTATION_STATUS.zh-CN.md` 是中文实现状态记录。
- `docs/CHATBOT_PROVIDER_DESIGN.md` 是 Chatbot 与多模型 Provider 设计索引。
- `docs/CHATBOT_PROVIDER_DESIGN.zh-CN.md` 是中文 Chatbot 与多模型 Provider 设计。
- `skills/personal-agent-project/` 保存项目专属 Codex Skill 草案。

## 当前路线判断

- 用户正在梳理“自己搭建 Agent 需要做哪些事情”。
- 项目建议先从个人真实场景、最小 Agent 核心、记忆系统、工具系统、任务规划、Skill/插件机制、安全权限和工程化逐步推进。
- 第一阶段优先做能在本仓库里长期协助搭项目的 CLI 版最小 Agent，而不是一开始做复杂 UI 或全能自治系统。
- UI 形态的阶段性判断：第一阶段建议使用 CLI + 本地 Web UI，并让 Agent Core 与 UI 解耦；暂时不要绑定 Electron/Tauri。未来如果要做类似 Codex 的本地桌面工作台，再评估桌面壳。若以 TypeScript/Node.js 生态快速实现本地桌面体验，可优先考虑 Electron；若后期更重视体积、安全和性能，可评估 Tauri。
- 用户构想的 Agent 更偏向“工作协作体”，不是单一助手。系统以“项目”作为输入和输出口，由项目角色协调产品、技术、开发、测试等工种角色工作，未来可扩展设计、视频、音频等角色。
- 技术选型需要前期确定，但应分层处理：先确定 TypeScript/Node.js、Monorepo、Agent Core 与 UI 解耦、多角色协作数据模型、文件优先存储、Provider 抽象和工具权限模型；UI 组件库、向量库、队列、Electron/Tauri 等可延迟到核心闭环后再定。
- 用户现在明确希望做类似 Codex 的 Electron GUI 工具，具有节点式编排能力，重点实现角色扮演式 Agents 编排，并支持串行和并行执行相关 Agents 任务。新的阶段性方向是 Electron 桌面壳 + React/节点画布 + 独立 Agent Core + 轻量 DAG 编排引擎。
- 2026-05-04 已搭建第一版工程骨架：pnpm monorepo、Electron + React 桌面应用、React Flow 节点画布、shared 类型包、core 包、默认角色定义、sample workflow、轻量 DAG 执行器、preload + IPC API。当前执行器为模拟产出，尚未接真实模型 Provider 和真实工具调用。
- 用户希望增加 Chatbot，通过其他模型接入后继续完成整个项目。阶段性设计：Chatbot 作为项目协作入口，不替代节点画布；通过 Core 侧 Model Provider Registry 接入模型，第一版优先做 OpenAI-compatible Provider；Renderer 不直接请求模型 API，API Key 不进入 Renderer；未来不同角色可绑定不同模型。
- 2026-05-04 Chatbot 已从纯 UI mock 推进到 Core 链路：新增 Chat/Provider 共享类型、Core ChatService、Mock Provider、模型配置列表、Electron `sendChatMessage` IPC，ChatPanel 已通过 Core 返回的会话消息刷新 UI。真实 OpenAI-compatible Provider、流式输出和会话持久化尚未实现。
- 2026-05-04 新增 Agent Builder 页面，用于用户自己组建完成项目开发的 Agent 团队。页面包含角色选择、核心开发阶段、默认模型、权限策略和团队摘要；当前仅为 UI 层，尚未生成或保存真实工作流。
- 2026-05-04 用户进一步明确默认页面应是极简对话入口，后续组建 Agent、生成编排和完成项目开发都希望通过对话完成，而不是默认展示复杂配置页。已新增 ChatHomePage，并将默认页面切换为对话入口；编排画布和组建团队页面保留为导航入口。
- 2026-05-04 用户再次收敛产品方向：默认页面应类似 Claude Code，只保留一个对话入口；不要默认导航、说明卡、组建团队页面、编排画布或复杂配置。后续编排、对话记忆、Agent 组建和项目开发都应通过对话产生。已新增 MinimalChatPage，并让 App 顶层直接渲染极简对话页。
- 2026-05-04 用户提供 MiMo Python 调用示例，要求改成 TS 版本接入。已使用 `@anthropic-ai/sdk` 在 Core 侧实现 `mimo-anthropic` Provider，读取环境变量 `MIMO_API_KEY` 或本地 secrets，baseURL 最终更正为 `https://token-plan-cn.xiaomimimo.com/anthropic`，默认模型为 `mimo-v2.5-pro`。极简 Chat 默认使用 MiMo Provider；API Key 不进入 Renderer。
- 2026-05-04 用户希望增加本地 key 配置文件且不要提交。已新增 `config/secrets.example.json` 作为模板，约定真实文件为 `config/secrets.local.json` 并加入 `.gitignore`。Core 读取 MiMo key 的顺序为本地 `mimoApiKey` 优先，其次环境变量 `MIMO_API_KEY`。
- 2026-05-04 修复本地 key 已写但应用无反应的问题：`localSecrets.ts` 现在会从运行目录向上逐级查找 `config/secrets.local.json`，并且不缓存 secrets；模型配置列表也改为动态生成。
- 2026-05-04 用户希望在 GUI 里直接查看模型接口请求和返回。已新增 Provider GUI 调试面板：Core 内存记录最近请求、响应、错误、耗时和 baseURL，不记录 API Key；极简对话页右上角可打开“调试”抽屉查看。
- 2026-05-04 用户进一步要求调试面板能查看请求接口和携带参数。已扩展 ProviderDebugLog，记录 method、endpoint、headers 安全摘要和请求 body；GUI 调试抽屉展示请求 Headers、请求 Body、响应内容和错误，API Key 始终隐藏。
- 2026-05-05 用户希望 Chat 输出改为流式，避免一次性返回显得奇怪。已新增 ChatStreamEvent、Provider streamChat、ChatService streamChatMessage、Electron IPC 流式事件和前端 delta 追加渲染；MiMo Provider 使用 Anthropic SDK `stream: true`。
- 2026-05-05 用户要求清理项目，只保留基础对话入口和交互，删除其他遗留项。已删除旧画布、组建团队、旧 ChatPanel、角色/工作流模拟等代码；移除 React Flow 依赖；核心代码收敛为 MinimalChatPage + ChatService + MiMo 流式调用 + 调试面板。
- 2026-05-05 系统 Prompt/角色记忆文件约定为 `packages/memorizes/agents.md`。不要在业务代码里使用 `../memorizes/agents.md` 这类源码相对路径，因为 Electron/Vite 运行时会按当前工作目录或构建产物目录解析，容易读不到文件；Core 侧 `readMarkdown` 已改为从项目根目录查找稳定路径，并提供默认 Prompt 兜底。
- 2026-05-05 Chat 发送链路拆为两段：用户按 Enter 后，Core 先调用本地 Ollama 小模型 `qwen2.5:1.5b` 进行意图识别，接口为 `http://127.0.0.1:11434/api/chat`；随后将意图识别摘要注入 MiMo 大模型 System Prompt 上下文，再进行流式对话输出。Ollama 失败时不阻断主对话，会记录调试日志并用兜底摘要继续调用 MiMo。
- 2026-05-05 用户明确偏好：代码需要按职责拆分到不同文件，避免把 Provider、Prompt、Session、编排和 UI 逻辑揉在一起；项目早期不需要加入过多容错机制，优先让错误暴露出来便于定位；避免在业务代码里使用 `yield`、`async function*`、`for await` 等相对冷门语法，流式事件优先使用普通回调或事件监听。
- 2026-05-05 修正意图识别上下文注入方式：System Prompt 只保留稳定角色和项目规则，来自 Ollama 的本轮意图识别结果不再塞进 `system`；MiMo 请求时会将意图识别结果作为临时 `user` role 上下文消息插入到 messages 中，且不写入真实会话历史。
- 2026-05-05 用户希望 Prompt 也按模块拆分，便于手动修改。当前主路径已改为 `packages/memorizes/system/*.md` 组装大模型 System Prompt，`packages/memorizes/intent/*.md` 组装 Ollama 意图识别 Prompt，`packages/memorizes/context/intent-result.md` 组装意图识别结果给 MiMo 的临时上下文。旧的 `packages/memorizes/agents.md` 和 `packages/memorizes/intent.md` 暂时保留为历史内容，不再是主读取路径。
- 2026-05-05 修正 Ollama 意图识别请求的 role 分工：`packages/memorizes/intent/01-parser.md` 只进入 `system`，用于描述解析器规则；`packages/memorizes/intent/02-input.md` 只进入 `user`，用于承载最近对话和用户输入。不要把规则提示词拼进 user content。
- 2026-05-05 修复 Ollama 意图识别 `intent` 为空的问题：原因是小模型容易照抄空 JSON 模板，且提示词没有明确要求 `intent` 必填。`packages/memorizes/intent/01-parser.md` 已改为要求 `intent` 必须五选一，并增加判定规则和示例；`ollamaIntentProvider.ts` 增加轻量 JSON 校验，若 intent 为空或非法则直接报错，方便开发期定位。
- 2026-05-05 修复小模型将 `intent` 返回为 `"code | chat | search | analysis"` 的问题：Prompt 中不要把枚举值写成管道占位字符串，容易被小模型照抄；已改成单选题描述，并为“我想搭建一个自己的agent”增加 `analysis` 示例。代码侧 `normalizeIntent` 会把偶发的管道串收敛为第一个合法 intent。
- 2026-05-05 用户发现 API 模型回复可能像被截断。MiMo 请求的 `max_tokens` 从 1024 提高到 4096；Provider 调试日志新增 `stopReason` 和 `usage`，GUI 调试面板展示停止原因。若 `stopReason` 为 `max_tokens`，说明确实被输出上限截断；若为 `end_turn`，则是模型自行结束。
- 2026-05-16 记忆系统长期方向：如果只给 Agent 自己使用、尤其面向重度 AI 用户，应优先考虑数据库式记忆而不是纯 Markdown/文件。原因是 Agent 记忆核心操作是按项目、类型、重要性、时间、语义相似度进行查询和召回，而不是人类打开文档编辑。建议未来采用 SQLite 作为本地主存储，保存 events、memories、sessions 等结构化数据；后续可叠加 sqlite-vec/sqlite-vss 做本地向量检索；文件系统用于大文本、附件、导出、人类可读备份和项目快照。当前阶段先记录设计方向，不急于实现。
- 2026-05-16 记忆关联模型：短期记忆对话、意图识别、工具调用和长期规划不应作为互不相干的文本保存，而应通过结构化字段关联。建议未来使用 `project_id` 作为最大作用域，`session_id` 表示一段短期上下文，`events` 保存原始对话/工具调用/intent，`memories` 保存从 events 提炼出的长期事实、偏好、决策、规划。长期记忆应保存 `source_event_ids` 追溯来源，并带有 `type`、`tags`、`importance`、`confidence`、`created_at`、`updated_at` 等字段。检索时先按 `project_id` 过滤，再结合 `type/tags/importance/time/embedding` 召回相关短期轨迹和长期规划。
- 2026-05-16 大模型上下文组织格式：意图识别和记忆不应穿插进真实对话轮次中，而应汇总为“内部上下文”集中放在真实对话前面；真实对话必须保持按时间顺序的 `user -> assistant -> user -> assistant`。推荐结构为：`system` 放稳定角色规则；`messages[0]` 放一条 `user` role 的内部上下文（最近 5 条 intent、项目记忆、任务状态等，并明确不是用户真实输入）；随后放真实历史对话，最后放当前用户输入。不要使用 `user1,user2,intent1,intent2,assistant1,assistant2` 这种分组顺序，也不要把 intent 每轮穿插成真实对话。
- 2026-05-16 模型返回处理第一阶段：先处理 `stopReason === "max_tokens"` 的截断情况。`streamMimoChat` 从返回纯字符串升级为 `ModelResponse { content, stopReason, usage }`；ChatService 在 `max_tokens` 时给最终助手消息末尾追加系统提示，告知内容可能被截断并建议用户输入“继续”。当前不做自动续写，避免返回链路过早复杂化。
- 2026-05-16 `max_tokens` 后续策略：达到最大输出长度不应视为普通失败，而应进入“可继续生成”的状态。阶段策略为：第一阶段只在最终回复末尾提示“可能被截断，可以输入继续”；第二阶段在 UI 显示“继续生成”按钮，由用户触发续写；第三阶段再考虑受控自动续写，必须限制最大续写次数（如 1-2 次）并继续检查 stopReason，避免无限循环、重复内容和成本失控。续写上下文应包含原问题、已生成的截断内容，以及一条“请从上一条回复中断处继续，不要重复前文”的用户指令。
- 2026-05-16 模型返回链路异常分类与处理优先级：返回后应区分 `complete` 正常结束、`truncated` 达到最大输出、`empty` 空回复、`api_error` API/网络错误、`structured_output_error` 结构化输出失败、`stream_interrupted` 流式中断、`user_abort` 用户取消、`refusal/safety` 拒答或安全拦截。当前已优先处理 `max_tokens/truncated`；下一步建议处理 `empty response`，再处理 API 错误分类，然后处理流中断。用户取消、安全拒答等可后续再加。
- 2026-05-16 上下文构建模块化方向：不要把所有内容都当作聊天记录直接塞给模型，而是先拆成语义层再统一组装。建议层次为：`system prompt` 稳定角色规则；`internal context` 内部上下文（最近 intent、项目记忆、任务状态、工具结果、约束等，明确不是用户真实输入）；`conversation history` 真实对话历史，保持时间顺序；`current user input` 当前输入。后续应新增类似 `modelContextBuilder.ts` 的模块，专门负责按固定顺序组装 `system` 和 `messages`，Provider 只负责调用模型 API，不负责业务上下文拼装。
- 2026-05-16 缓存友好的上下文顺序修正：动态 internal context 不应固定放在 `messages[0]`，否则每轮前缀变化会降低 prompt/KV cache 命中。新的推荐顺序为：`system` 放稳定角色规则；稳定项目/工具规则尽量前置；真实历史对话保持时间顺序；本轮动态上下文（taskState、最近 intent、最近 toolResult 等）放在当前用户输入前；最后放当前用户输入。当前 `mimoProvider` 已将 MiMo messages 调整为 `historyMessages -> runtimeContextMessage -> latestUserMessage`。
- 2026-05-16 会话压缩规则：会话压缩不是每轮都做，也不是 KV cache/prompt cache 本身。第一版采用“多轮累积后再压缩”：当真实历史超过约 12-20 轮、预计上下文达到预算 60%-70%、任务阶段切换，或用户显式要求总结/压缩时触发。压缩只覆盖较早真实对话，保留最近 3-5 轮、当前输入和本轮动态上下文。压缩产物为 `session_summary`、`decisions`、`open_questions`、`constraints`、`task_progress`、`source_range`，写入 SQLite 的 `conversation_summaries`，原始 events 不删除。
- 2026-05-16 会话压缩第一版已实现：项目已接入 `better-sqlite3`，默认数据库为 `data/agent.db` 且不提交。新增 `conversation_summaries` 表、Ollama 压缩 Provider、压缩 Prompt 模块和 ChatService 压缩检查。当前规则为消息数达到 24 条后考虑压缩，保留最近 10 条消息，每次至少 6 条新增旧消息才增量压缩。MiMo 上下文会用摘要替代较早历史。当前尚未实现 events 全量持久化、token 预算触发、压缩结果 UI 展示和长期 memories 提升。
- 2026-05-16 Events 原始事件链第一版已实现：SQLite 新增 `events` 表，记录 `chat_message`、`router_result`、`conversation_summary`、`model_return`、`error` 等事件。ChatService 已写入用户消息、Router 结果、MiMo stopReason/usage、助手消息；会话压缩完成后写入压缩摘要事件。Core 已导出 `listSessionEvents`，后续 UI/Trace 可读取。当前还未实现 UI 展示、错误事件统一写入、从 events 恢复 ChatSession、工具/任务/多 Agent run 事件接入。
- 2026-05-16 Events GUI 可观测性第一版已实现：Electron 新增 `workbench:list-session-events` IPC，Preload 暴露 `window.workbench.listSessionEvents`。极简 Chat 调试抽屉新增 `模型请求` / `事件链` 两个 Tab，事件链展示当前 session 最近 100 条 events 的 type、actor、roleLabel、messageId、createdAt、content 和 payload。当前这还不是完整 Agent Trace，但已经能从 GUI 观察每轮对话背后的原始事件。
- 2026-05-16 Router 完整 Schema 第一版已实现：共享类型新增 `RouterResult`，Ollama Router 输出从旧版 intent/keywords 升级为 `intent`、`rewritten_input`、`keywords`、`is_task`、`task_goal`、`task_type`、`requires_project_context`、`needs_tools`、`suggested_tools`、`tool_reason`、`confidence`。Core 会归一化 `task_type`、`suggested_tools` 和 `confidence`，并把完整 Router JSON 写入 `router_result` event 和 MiMo 内部上下文。同时 ChatService 已统一把压缩、Router、MiMo 等链路错误写入 `error` event。当前 Router 还未驱动真实工具选择、任务状态和 Command Gateway。
- 2026-05-16 Tool Selection Policy 第一版已实现：新增 `toolSelectionPolicy.ts`、`ToolSelectionResult`、`ToolAccessMode` 和 `tool_selection` event。ChatService 会在 Router 后执行工具选择，并把结果写入 SQLite events，同时连同 Router 结果一起注入 MiMo 内部上下文。第一版规则使用 `confidence >= 0.7` 才自动开放工具；`chat` 不开放；`search` 因 web.search 未实现暂不开放；`analysis` 不需要项目上下文时不开放；可选工具只有 `command.run`。`code/implementation` 对应 `project_write`，`debug/debugging/verification` 对应 `project_verify`，项目分析对应 `project_read`。当前只是选择工具，还未实现 Command Gateway 执行。
- 2026-05-16 Command Gateway 第一版已实现：新增 `CommandRunRequest`、`CommandRunResult`、`toolCallParser.ts`、`commandGateway.ts`，并新增 `tool_call` / `tool_result` events。MiMo 如果在回复中输出 `command.run` JSON 代码块，ChatService 会在回复结束后解析，最多处理 8 条，交由 Command Gateway 判断并执行/拒绝/跳过，再把结果追加到助手消息并写入事件链。第一版只支持 PowerShell，`cwd` 必须在工作区内；读/验证/写权限由 `ToolSelectionResult.access_mode` 控制；危险命令直接拒绝，需要确认但暂无确认 UI 的命令返回 `confirm/skipped`。当前这是一步工具执行，还不是完整多轮 ReAct，也不会自动再调用 MiMo 总结工具结果。
- 2026-05-16 一步 ReAct 工具结果整理已实现：如果本轮执行了 `command.run`，ChatService 会追加一次 MiMo 调用，让模型基于 Command Gateway 返回的工具结果生成最终回应。第二次调用不会再次解析工具请求，避免无限循环。事件顺序为第一次 `model_return`、`tool_call`、`tool_result`、第二次 `model_return`、最终 `chat_message`。当前第一次 MiMo 输出的 command.run JSON 仍会出现在消息中，后续可优化为隐藏工具请求块。
- 2026-05-16 工具请求块隐藏已实现：`ChatStreamEvent` 新增 `replace`，Renderer 支持替换当前助手消息内容；`toolCallParser.ts` 新增 `removeCommandRunRequestBlocks`。ChatService 会保留原始 MiMo 内容用于解析工具请求，但在用户可见消息和最终 `chat_message` 中移除 `command.run` JSON 代码块。完整工具请求仍保存在 `tool_call` event，工具结果仍保存在 `tool_result` event。当前流式过程中 JSON 可能短暂出现，第一次 MiMo 完成解析后会被替换。
- 2026-05-16 模型调用抽离与可视化配置已实现：新增 `ModelRuntimeSettings`，本地配置路径为 `config/model-runtime.local.json` 且不提交，模板为 `config/model-runtime.example.json`。GUI 右上角新增 `模型` 按钮，可配置 `router`、`main`、`compression` 三类模型的 Provider、Base URL、Model、API Key、Temperature、Max Tokens。新增 OpenAI-compatible Provider，支持 DeepSeek 等 `/chat/completions` 服务；Router/Compression 支持 `ollama` 和 `openai-compatible`，Main 支持 `anthropic-compatible` 和 `openai-compatible`。GUI 提供 DeepSeek 预设：Router/Compression 使用 `deepseek-v4-flash`，Main 使用 `deepseek-v4-pro`，Base URL 为 `https://api.deepseek.com`。
- 2026-05-16 工具系统方向：用户不希望第一版为每个能力都封装独立工具函数，更希望类似 Codex/Claude Code 通过 CLI/Shell 操作工作区，让安全操作自动放行、高风险操作确认。第一版建议以 `command.run` 作为模型侧通用 function call，内部实现 `Command Gateway`：解析命令、按工作区约束和安全策略分类为 `allow/confirm/deny`、执行命令、记录 stdout/stderr/exitCode。Function Call 是模型到系统的结构化调用协议，Command Gateway 是本地执行模式；两者可组合为 `command.run -> Command Gateway`。
- 2026-05-16 Command Gateway 初步安全策略：自动放行读操作和验证操作，如 `Get-ChildItem`、`Get-Content`、`Select-String`、`Test-Path`、`Resolve-Path`、`git status`、`git diff`、`git log`、`pnpm build`、`pnpm test`；需要确认的操作包括写文件、删除/移动/复制、新建文件、`git add/commit/push`、安装依赖、未知命令；禁止高风险命令如系统目录递归删除、格式化磁盘、`curl | iex`、`Invoke-Expression`、越出工作区的破坏性操作。后续高频且需要更强安全边界的能力可从 `command.run` 抽成专用工具，如 `memory.search`、`project.updateTask`、`file.applyPatch`。
- 2026-05-16 Command Gateway 用户确认的第一版默认策略：`pnpm build` / `pnpm test` 可以自动执行；工作区内写文件无需确认；每轮最多执行 8 个命令。仍需保留工作区边界和危险命令禁止策略，尤其禁止系统目录破坏、`Invoke-Expression`、`curl | iex`、工作区外破坏性操作等。
- 2026-05-16 Command Gateway 第一版收口方案：第一版只支持 PowerShell，不做 cmd/bash 多 shell；默认工作区为当前项目 `D:\AICode\XiaoMiCode`，`cwd` 必须位于工作区内。命令请求必须包含 `type=command.run`、`reason`、`shell`、`cwd`、`command`。执行前先生成 command plan，再经过 policy 判断。默认超时为 30 秒，`pnpm build/test` 为 120 秒；stdout/stderr 默认各截断到约 20,000 字符；每轮最多 8 个命令。命令结果必须回传给模型作为内部上下文，同时记录审计日志：sessionId/turnId/reason/shell/cwd/command/decision/status/exitCode/stdout/stderr/durationMs/createdAt。第一版暂不做复杂确认 UI、后台长任务、多 shell、自动安装依赖、git commit/push、无限工具循环。
- 2026-05-16 工具选择策略：不要每轮把所有工具都暴露给大模型，而是先由小模型识别 intent，Core 再用规则选择本轮可用工具。第一版映射：`chat` 不给工具；`debug` 给 `command.run`；`code` 给 `command.run`；`analysis` 默认不给工具，但如果输入提到项目/文件/代码/当前实现，则给 `command.run` 的项目只读/验证能力；`search` 未来给 `web.search`，当前可暂不实现。工具选择和命令安全是两层：Core 决定是否把 `command.run` 暴露给模型，Command Gateway 再决定模型请求的具体命令是 `allow/confirm/deny`。
- 2026-05-16 任务状态系统方向修正：因为用户未来要多个 Agent 反复调用执行，不应限制为“一个 active task”。设计应允许一个项目下存在多个 `active` tasks，但每次对话回合或每次 agent run 只聚焦一个 `focusedTaskId`。`active task` 表示项目中正在进行的工作单元，`focused task` 表示当前对话/当前 agent run 正在处理的任务。这样既支持多任务并行/串行，也避免每次上下文把所有任务全文都塞给模型。
- 2026-05-16 任务状态第一版建议直接使用 SQLite，而不是先内存。建议表：`tasks` 保存任务主体（project_id/title/goal/type/status/phase/time），`task_steps` 保存子步骤，`task_blockers` 保存阻塞点，`task_focus` 保存项目当前 focused_task_id，`agent_runs` 保存某个 agent 针对某任务的一次执行记录，`task_dependencies` 保存任务依赖关系。给大模型时只传 focused task 详情、相关依赖任务摘要、其他 active tasks 的简短列表，不传所有任务全文。
- 2026-05-16 Router 小模型输出 schema 确认：小模型不再只是单一 intent 分类，而是输出给 Core 的“路由报告”。第一版字段为：`intent`（chat/analysis/code/debug/search）、`rewritten_input`、`keywords`、`is_task`、`task_goal`、`task_type`（chat/analysis/design/implementation/debugging/verification）、`requires_project_context`、`needs_tools`、`suggested_tools`、`tool_reason`、`confidence`。Router 只给建议，Core 负责校验和修正，Command Gateway 负责具体命令安全执行。
- 2026-05-16 Router/SQLite 关键决策：Router 置信度阈值确认使用 `0.7`，`confidence >= 0.7` 才按 Router 建议进行较自动化的工具开放/任务创建，低于阈值时 Core 保守处理；`suggested_tools` 保留扩展设计，第一版主要支持 `command.run`，未来可扩展 `web.search`、`memory.search`、`project.updateTask` 等；SQLite Node/Electron 依赖确认使用 `better-sqlite3`。
- 2026-05-16 人类友好观察层方向：项目需要 Agent Trace / 调试观察台，不只看模型 API 请求/返回，而要能观察每一轮 agent 的完整链路：用户输入、Router 请求/返回、Core Policy 决策、上下文构建结果、模型请求/返回、工具调用、工具结果、任务状态变化、最终回复。建议 UI 调试面板升级为 Trace / Prompts / Models / Tools / State / Raw 等视图，方便人类查看各环节提示词、变量替换、最终 messages、stopReason、usage、命令 stdout/stderr、focusedTask、selectedTools 等。
- 2026-05-16 Agent Trace 数据结构方向：建议定义 `AgentTrace { id, sessionId, turnId, projectId, startedAt, completedAt, steps }` 和 `TraceStep { id, type, label, status, input, output, startedAt, completedAt, durationMs }`。Step 类型可包括 `user_input`、`router_request`、`router_response`、`core_policy`、`context_build`、`model_request`、`model_response`、`tool_call`、`tool_result`、`task_update`、`final_response`、`error`。第一版可以先内存保存最近 20 条 trace，后续写入 SQLite 表 `agent_traces` / `trace_steps`。
- 2026-05-16 多 Agent 协作第一版确认：核心角色为 `project`、`product`、`tech`、`developer`、`tester`。`project agent` 作为 coordinator 和用户输入/输出口，负责拆任务、分配角色、收集结果、决定下一步、最终汇总。其他 agent 第一版不直接对用户说话，也不互相自由对话，而是通过 `agent_runs` 针对 task 交付结构化结果，由 coordinator 汇总。第一版串行执行，不做并行；每个 agent 使用独立 prompt；第一版可共用 MiMo 模型；工具调用由 Core/Command Gateway 控制；UI 通过 Agent Trace 展示各 agent run。
- 2026-05-16 GUI 默认暗色模式已实现：极简对话入口、输入区、消息气泡、模型配置抽屉、调试抽屉、模型请求日志和事件链都切换为暗色主题。当前是默认暗色，没有做亮/暗主题切换开关。
