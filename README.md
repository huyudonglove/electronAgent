# huydAgent

本项目是一个本地优先的 Electron Agent 工作台，围绕对话、Router、Planning、Tool Gateway、Memory 和执行链路可视化展开，适合作为个人 Agent 系统的实验与演进基础。

![huydAgent 界面截图](https://github.com/user-attachments/assets/6a280f4d-1226-4092-a976-3b6e0df57850)

## 当前特性

- Electron + React 桌面工作台
- Router / Planning / Execution / Evaluator 分阶段链路
- 本地工具执行与运行日志
- 长期记忆与环境指纹
- 模型库、流程面板、调试视图

## 本地运行

```powershell
corepack pnpm install
corepack pnpm build
```

本地模型与密钥配置请参考：

- [docs/SETUP_LOCAL_CONFIG.zh-CN.md](docs/SETUP_LOCAL_CONFIG.zh-CN.md)
