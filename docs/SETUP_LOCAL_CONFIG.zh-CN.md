# 本地配置说明

本文档用于说明本项目在本地运行时需要怎样配置模型 Key，以及哪些文件属于本地运行态、不会提交到仓库。

## 本地配置文件

### 1. `config/secrets.local.json`

用于存放不希望提交到仓库的敏感信息。

示例可参考：

- [config/secrets.example.json](../config/secrets.example.json)

示例结构：

```json
{
  "mimoApiKey": "your_mimo_api_key_here"
}
```

说明：

- 真实文件名必须是 `config/secrets.local.json`
- 该文件已加入 `.gitignore`
- 不要提交到仓库

### 2. `config/model-runtime.local.json`

用于保存本地模型运行配置，例如：

- Router 用哪个模型
- Main 用哪个模型
- baseURL
- tool calling mode

说明：

- 该文件属于本地运行态配置
- 已加入 `.gitignore`
- 不建议提交到仓库

## 运行时数据目录

项目运行时会产生以下本地数据：

- 会话数据库
- 运行日志
- 记忆数据

开发态下历史上可能落在项目根目录 `data/`；
当前 Electron 打包态已优先改为使用应用 `userData` 目录。

无论哪种情况，这些都属于本地运行态文件，不应提交。

## 环境变量

如果不使用本地 secrets 文件，也可以通过环境变量提供部分 Key。

例如：

```powershell
$env:MIMO_API_KEY="your_key"
```

但更推荐用本地 `secrets.local.json`，便于和开源仓库隔离。

## 开源仓库注意事项

以下文件或目录不应提交：

- `config/secrets.local.json`
- `config/model-runtime.local.json`
- `data/`
- `apps/desktop/dist/`
- `apps/desktop/dist-electron/`
- `apps/desktop/release/`

## 推荐流程

1. 克隆仓库
2. 安装依赖
3. 复制示例配置文件
4. 填写本地 Key
5. 启动开发或执行打包

例如：

```powershell
corepack pnpm install
corepack pnpm build
```
