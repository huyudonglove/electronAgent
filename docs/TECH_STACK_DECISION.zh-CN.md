# 技术选型决策

## 结论

前期需要确定技术选型，但要分层确定。

必须早定的是会影响系统边界、数据模型、运行方式和长期扩展方式的技术选择。可以晚定的是具体 UI 组件库、向量数据库、队列系统、部署平台等可替换实现。

## 需要前期确定的选择

### 1. 语言与运行时

建议第一阶段使用 TypeScript / Node.js。

原因：

- 适合同时做 CLI、本地服务、Web UI 和未来 Electron 桌面壳。
- 工具调用、文件系统、Shell、Git、本地开发生态成熟。
- 前后端可以共享类型定义。
- 后续接入 Electron 成本低。

### 2. 系统形态

建议采用 Monorepo。

初始结构可以是：

- `apps/cli`：命令行入口。
- `apps/web`：本地 Web UI。
- `packages/core`：Agent Core。
- `packages/roles`：角色定义和协作流程。
- `packages/tools`：工具系统。
- `packages/memory`：记忆系统。
- `packages/shared`：共享类型和工具函数。

### 3. Agent Core 边界

Agent Core 必须独立于 UI。

核心职责：

- 模型调用。
- 消息和上下文管理。
- 工具调用。
- 角色执行上下文。
- 项目状态。
- 日志和审计。

CLI、Web UI、未来 Electron/Tauri 都应该调用同一个 Core，而不是各自实现一套 Agent 逻辑。

### 4. 多角色协作模型

前期需要把核心数据模型定下来。

建议至少包含：

- Project：项目。
- Role：角色。
- Task：任务。
- Artifact：产出物。
- Handoff：角色交接。
- Review：审查反馈。

第一版不做复杂并发多 Agent，先实现单进程、多角色轮流执行。

### 5. 存储方式

第一阶段建议使用文件存储。

建议：

- Markdown：保存人类可读的项目记忆、背景、总结、产出。
- JSON/YAML：保存角色配置、任务状态、工具定义、运行记录索引。
- SQLite：可以作为第二阶段选项，用于查询任务、日志、运行记录和项目状态。

不要第一阶段就引入复杂数据库和向量库。

### 6. 模型供应商抽象

需要前期设计 Provider 抽象，但不必一开始支持很多供应商。

第一版可以只实现一个 OpenAI-compatible Provider，通过 `baseURL + apiKey + model` 接入不同模型服务。后续再按需要增加专用 Provider Adapter。

接口应支持：

- 普通对话。
- 结构化输出。
- 工具调用。
- 流式输出。
- 模型配置。

模型调用和 API Key 管理必须放在 Electron Main/Core 侧，Renderer 不能直接请求模型 API。

### 7. 工具权限模型

工具系统需要前期设计权限边界。

至少区分：

- 只读工具。
- 写入工具。
- 命令执行工具。
- 网络工具。
- 高风险工具。

每个角色可拥有不同工具权限。

### 8. UI 技术路线

当前用户进一步明确希望使用 Electron 做类似 Codex 的 GUI 工具，并具备节点式 Agent 编排能力。

更新后的建议：

- Electron 作为桌面壳。
- React 作为 UI 框架。
- React Flow/xyflow 作为节点式编排画布。
- Agent Core 与 Electron/UI 解耦。
- 第一版自研轻量 DAG 执行器，支持串行、并行、合并、失败暂停和重试。
- 后续再评估 LangGraph、队列系统或更复杂的工作流运行时。

## 可以延迟的选择

这些不需要现在锁死：

- UI 组件库。
- 图标库。
- CSS 方案。
- 向量数据库。
- 队列系统。
- 后台任务框架。
- Electron 还是 Tauri。
- 云部署平台。
- 多模型路由策略。

这些选择应该等第一版核心闭环跑通后，根据真实需求决定。

## 推荐第一阶段技术栈

- 语言：TypeScript。
- 包管理：pnpm。
- 仓库结构：Monorepo。
- CLI：Node.js CLI。
- 桌面壳：Electron。
- UI：React。
- 节点画布：React Flow/xyflow。
- 本地服务/Core：Node.js 模块或本地 HTTP API，具体边界可在初始化时确认。
- 存储：Markdown + JSON/YAML 文件。
- 模型：先接一个 Provider。
- 测试：Vitest。
- 代码规范：ESLint + Prettier。

## 架构原则

- Core 先行，UI 后置。
- 项目是系统核心对象，不只是文件夹。
- 角色是可配置的专业执行上下文，不是硬编码分支。
- 工具系统必须有权限和审计。
- 记忆先用简单文件跑通，再演进到数据库或向量库。
- 不为了“像完整平台”而提前引入复杂基础设施。
