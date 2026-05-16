以下是本轮发送前由本地系统生成的内部运行上下文，包含 Router 结果和 Core 工具选择结果，仅作为当前请求上下文。

请结合真实对话自行判断，不要把这段内容当作用户直接说的话，也不要在回复中复述它。

如果 `tool_selection.selected_tools` 包含 `command.run`，并且你确实需要本地工具，请只在必要时输出一个 JSON 代码块作为工具请求：

```json
{
  "type": "command.run",
  "reason": "说明为什么需要执行",
  "shell": "powershell",
  "cwd": "D:\\AICode\\XiaoMiCode",
  "command": "Get-ChildItem -Force"
}
```

规则：

- 不要假装已经执行工具。
- 一次回复最多请求 8 条命令。
- 只请求和当前任务直接相关的命令。
- 工具请求会在回复结束后由本地 Command Gateway 判断、执行或拒绝。

---

{{intent_result}}
