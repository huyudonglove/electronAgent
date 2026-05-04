# UI 与桌面壳选择记录

## 问题

用户想知道个人 Agent 项目应该直接使用 Web UI，还是需要 Electron/Tauri 这类桌面壳，并希望体验接近 Codex 这种本地 Agent 工作台。

## 当前建议

用户后续明确希望使用 Electron 做类似 Codex 的 GUI 工具，并具备节点式 Agent 编排能力。因此当前建议调整为：

1. Agent Core：独立核心服务/模块，负责模型调用、工具调用、记忆、任务状态、编排执行和日志。
2. Electron：作为桌面壳，提供类似 Codex 的本地工作台体验。
3. React UI：作为 Renderer 层界面。
4. React Flow/xyflow：作为节点式编排画布。

即便使用 Electron，也不能把 Agent 逻辑写死在 Renderer 中。Core 仍然需要独立于 UI，保证后续 CLI、测试、自动化运行和其他界面都能复用。

## 为什么先 Web UI

- 开发速度快，便于验证 Agent 核心能力。
- UI 技术栈可直接复用到 Electron/Tauri。
- 早期不需要处理安装包、自动更新、系统兼容和桌面权限问题。
- 更容易先把模型调用、工具系统、记忆和任务循环做扎实。

## 为什么未来可能需要桌面壳

如果目标是类似 Codex 的本地 Agent 工作台，桌面壳会变得有价值，因为它更适合：

- 管理本地项目和工作区。
- 调用 Shell、Git、文件系统、终端等本地能力。
- 做系统通知、托盘、后台任务。
- 管理本地权限和敏感操作确认。
- 提供更像原生应用的入口。

## Electron 与 Tauri 的倾向

如果 Agent 核心和工具生态主要使用 TypeScript/Node.js，Electron 的集成阻力更小，适合早期快速做出类似 Codex 的桌面工作台。

如果更看重安装包体积、安全边界、性能，以及愿意引入 Rust/Tauri 后端，Tauri 更适合作为后期桌面壳方案。

当前项目不必马上二选一。更好的架构决策是：让 UI 与 Agent Core 解耦，使同一套 Web UI 未来既能在浏览器中运行，也能被 Electron 或 Tauri 包装。

## 阶段性结论

- 现在：Electron GUI + 独立 Agent Core。
- UI：React + React Flow/xyflow。
- 编排：第一版自研轻量 DAG 执行器，支持串行、并行、合并、失败暂停和重试。
- 后续：当长任务恢复、复杂多 Agent 状态机、人类介入和持久运行变复杂时，再评估 LangGraph 或队列系统。
