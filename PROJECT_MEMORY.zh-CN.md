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
