# Chatbot 与多模型 Provider 设计

## 定位

Chatbot 不应该只是一个普通聊天窗口，而应该是整个 Agent 工作台的“项目协作入口”。

它承担三类职责：

- 用户入口：用户用自然语言描述目标、提问、补充需求。
- 项目协调：读取项目上下文、记忆、当前工作流和运行记录。
- 编排控制：可以建议角色分工、生成工作流、触发节点运行、解释产出物。

因此，Chatbot 与节点画布不是二选一关系：

- Chatbot 负责自然语言协作和调度意图。
- 节点画布负责可视化、可编辑、可复现的执行流程。
- Agent Core 负责真正执行模型调用、角色运行、工具调用和工作流。

## 总体架构

建议结构：

```text
Electron Renderer
  ├─ Chat Panel
  ├─ Workflow Canvas
  ├─ Run Panel
  └─ Settings

Electron Main / Preload IPC
  └─ 受控 API

Agent Core
  ├─ Chat Service
  ├─ Model Provider Registry
  ├─ Role Runtime
  ├─ Workflow Executor
  ├─ Tool Runtime
  ├─ Memory Service
  └─ Artifact Service
```

关键原则：

- Renderer 不直接请求模型 API。
- API Key 不进入 Renderer。
- Chatbot 只通过 preload 暴露的受控 IPC 调用 Core。
- Provider、模型配置、角色运行和工具调用都放在 Core/Main 侧。

## Model Provider 抽象

Provider 抽象需要先设计，但第一版不必支持很多厂商。

建议核心接口：

```ts
interface ModelProvider {
  id: string;
  name: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  streamChat?(request: ChatRequest): AsyncIterable<ChatStreamEvent>;
  structuredOutput?<T>(request: StructuredRequest): Promise<T>;
  toolCall?<TToolResult>(request: ToolCallRequest): Promise<TToolResult>;
}
```

建议相关对象：

- ProviderConfig：供应商配置，例如 baseURL、apiKeyRef、默认模型。
- ModelProfile：具体模型配置，例如模型名、上下文长度、温度、是否支持工具调用。
- ChatSession：一次项目聊天会话。
- ChatMessage：单条消息。
- ChatContext：注入给模型的项目上下文。
- ProviderCapability：模型能力标记。

## 第一版接入方式

第一版建议先做“OpenAI-compatible Provider”。

原因：

- 很多模型服务都提供 OpenAI-compatible API。
- 可以通过 `baseURL + apiKey + model` 接入不同供应商。
- 后续再为特殊供应商写专用 Adapter。

第一版配置项：

- Provider 名称。
- Base URL。
- API Key。
- 默认模型。
- 是否启用流式输出。
- 是否启用工具调用。

注意：

- API Key 开发阶段可放 `.env` 或本地配置文件。
- 后续桌面应用应使用系统级安全存储或 Electron 安全能力保存敏感信息。
- 配置文件里尽量保存 apiKeyRef，不直接保存明文 key。

## Chatbot 与项目上下文

Chatbot 每次请求模型时，不应该只传聊天消息，还要组装项目上下文。

建议上下文分层：

- 系统提示：说明这是多角色 Agent 工作台。
- 项目记忆：读取 `PROJECT_MEMORY.zh-CN.md` 等长期文件摘要。
- 项目背景：读取项目背景、技术选型、当前实现状态。
- 当前工作流：节点、边、角色、运行状态。
- 当前产出物：需求、方案、代码变更、测试报告。
- 最近会话：最近 N 轮聊天。

第一版可以先手工拼接上下文；后续再做 Context Builder。

## Chatbot 能力边界

第一版 Chatbot 建议支持：

- 普通对话。
- 解释当前项目状态。
- 根据用户目标建议角色分工。
- 生成或修改工作流草案。
- 触发当前 sample workflow 运行。
- 总结节点运行结果。
- 将重要信息写入中文项目记忆。

第一版暂不支持：

- 直接执行高风险 Shell。
- 自动改大量文件。
- 长期后台任务。
- 多模型自动路由。
- 自动选择最便宜或最快模型。

## 与角色 Agents 的关系

Chatbot 可以理解为“项目角色”的自然语言入口。

建议：

- 默认 Chatbot 使用项目角色提示词。
- 用户可以在 Chat 中点名角色，例如“让技术角色评估一下”。
- Chatbot 可以把问题委派给某个 Role Runtime。
- 角色节点执行时可以使用自己的模型配置。
- 不同角色未来可以绑定不同模型。

示例：

- 项目角色：使用强推理模型。
- 产品角色：使用通用对话模型。
- 开发角色：使用代码能力强的模型。
- 测试角色：使用便宜快速模型先扫一遍。

## UI 设计建议

建议在现有工作台中增加右侧或底部 Chat Panel。

第一版布局：

- 左侧：角色库 / 项目导航。
- 中间：节点编排画布。
- 右侧：Chat + Run 信息分 Tab。

Chat Panel 功能：

- 会话消息列表。
- 输入框。
- 模型选择。
- Provider 状态。
- “发送给项目角色”按钮。
- “生成工作流草案”按钮。
- “运行当前工作流”按钮。
- “记录到项目记忆”确认动作。

## 数据存储建议

第一版仍使用文件存储：

- `data/providers.json`：Provider 配置，不保存明文 key。
- `data/model-profiles.json`：模型配置。
- `data/chat-sessions/*.json`：聊天会话。
- `data/workflows/*.json`：工作流。
- `data/runs/*.json`：运行记录。

后续如果查询和筛选变复杂，再迁移到 SQLite。

## MVP 实现顺序

1. 定义 `ModelProvider`、`ChatRequest`、`ChatResponse` 类型。
2. 实现 OpenAI-compatible Provider。
3. 在 Electron Main/Core 侧读取 Provider 配置。
4. 新增 IPC：发送聊天消息、获取会话、列出模型配置。
5. GUI 新增 Chat Panel。
6. Chatbot 使用项目角色提示词和项目上下文。
7. 支持流式输出。
8. 支持 Chatbot 调用当前工作流运行。
9. 将聊天和运行结果保存到本地文件。

## 关键设计判断

- Chatbot 是项目协作入口，不是替代节点画布。
- Provider 抽象要早做，否则后续接不同模型会污染 Core。
- 第一版优先 OpenAI-compatible Provider，降低接入成本。
- API Key 和模型调用必须留在 Main/Core 侧。
- 不同角色未来可以绑定不同模型，但第一版可以先全局默认模型。

