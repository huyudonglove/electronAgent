---
name: personal-agent-project
description: Guide Codex when working on the XiaoMiCode personal AI agent project. Use when the user asks to design, implement, document, or evolve this repo; when decisions, preferences, architecture constraints, or project direction need to be preserved locally; when creating project-specific skills, memory, agent architecture, tool calling, planning loops, personal workflows, or background documentation for the user's long-term AI agent system.
---

# Personal Agent Project

## Overview

Use this skill to keep work on XiaoMiCode consistent across many conversations. The project is an early-stage personal AI agent system, built around the user's real workflow rather than a generic template.

## Working Rules

- Read `PROJECT_MEMORY.md` first to find the language-specific project memory files.
- Read `PROJECT_MEMORY.zh-CN.md` before making important design or implementation decisions.
- Read `docs/PROJECT_BACKGROUND.md` first to find the language-specific project background files.
- Read `docs/PROJECT_BACKGROUND.zh-CN.md` when the task touches project direction, scope, or long-term architecture.
- Record durable context locally when it matters for future work.
- Record important durable context in the Chinese language file first.
- Maintain multilingual content in separate language files instead of mixing languages in one long-term document.
- Prefer small, inspectable increments while the project is still forming.
- Keep the implementation personal and practical before generalizing into framework-like abstractions.
- Preserve user-authored changes and existing project memory.

## 中文记录规则

- 关键项目记忆必须优先写入中文文件，尤其是用户偏好、项目方向、架构决策、长期约束和开放问题。
- 多语言内容按文件拆分维护，不要在同一份长期文档里中英混排。
- 如果需要英文记录，更新对应的 `en-US` 文件。
- 面向未来协作的项目文档应优先让用户能直接阅读和确认。

## Durable Memory

Use these local files as the source of durable project context:

- `PROJECT_MEMORY.md`: index for language-specific project memory.
- `PROJECT_MEMORY.zh-CN.md`: primary Chinese project memory.
- `PROJECT_MEMORY.en-US.md`: English project memory.
- `docs/PROJECT_BACKGROUND.md`: index for language-specific project background.
- `docs/PROJECT_BACKGROUND.zh-CN.md`: primary Chinese project background.
- `docs/PROJECT_BACKGROUND.en-US.md`: English project background.
- `docs/MULTI_ROLE_COLLABORATION_MODEL.zh-CN.md`: Chinese design note for the multi-role collaboration model.
- `docs/TECH_STACK_DECISION.zh-CN.md`: Chinese technology stack decision note.
- `docs/ELECTRON_AGENT_WORKBENCH_REQUIREMENTS.zh-CN.md`: Chinese requirements draft for the Electron GUI agent workbench.
- `docs/IMPLEMENTATION_STATUS.zh-CN.md`: Chinese implementation status notes.
- `docs/CHATBOT_PROVIDER_DESIGN.zh-CN.md`: Chinese design note for chatbot and model provider integration.
- `skills/personal-agent-project/references/`: focused reference notes for this skill as the project grows.

When new information should be remembered, update the smallest appropriate language-specific file. Keep entries concise and dated only when timing matters.

## Project-Building Workflow

1. Clarify the immediate goal from the user's latest request.
2. Inspect the current repository before proposing architecture.
3. Check existing project memory and background documents.
4. Make the smallest useful implementation or documentation step.
5. Update durable memory when the work creates a new decision, preference, convention, or open question.
6. Verify the change with the lightest useful check.
7. Report what changed and what is now ready for the next step.

## Architecture Biases

- Start with a simple core that can run locally.
- Keep agent state, tools, planning, memory, and model/provider boundaries understandable.
- Prefer explicit interfaces before adding dynamic plugin behavior.
- Make security and permission boundaries visible when introducing local automation.
- Add tests and examples around behavior that will become foundational.

## Reference Notes

Add reference files only when they help future Codex sessions avoid rediscovering non-obvious context. Do not duplicate information already captured clearly in `PROJECT_MEMORY.md` or `docs/PROJECT_BACKGROUND.md`.

Current reference files:

- `references/initial-context.zh-CN.md`
- `references/initial-context.en-US.md`
