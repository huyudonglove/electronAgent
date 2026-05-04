# XiaoMiCode Project Background

## Project Intent

XiaoMiCode is an early-stage AI agent project. Its purpose is to build a personal agent system tailored to the user's own workflow, preferences, and long-term needs rather than a generic agent template.

The project should grow through many conversations and implementation passes. Important context must be recorded locally so future work does not depend only on chat history.

## Collaboration Principles

- Treat the project as a long-term collaboration from idea to usable system.
- Record durable information locally when it affects future decisions, including architecture choices, user preferences, constraints, naming conventions, workflows, and open questions.
- Record important durable context in Chinese first; maintain corresponding English files when useful.
- Maintain multilingual content in separate language files instead of mixing languages in one long-term document.
- Prefer small, understandable steps early in the project.
- Keep the system personal and practical: build for the user's real work patterns first, then generalize only when useful.
- Preserve a clear trail of decisions in project files.

## Initial Product Direction

The project is expected to explore and eventually implement a personal AI agent with capabilities such as:

- Tool calling and local automation.
- Project and conversation memory.
- Task planning and execution loops.
- Skills or plugins for repeatable workflows.
- Optional UI surfaces such as CLI, web, desktop, or messaging integrations.
- Model/provider integration, likely including OpenAI APIs.

These are starting directions, not final requirements. They should be refined as the user clarifies priorities.

## Durable Memory Locations

- `PROJECT_MEMORY.md`: project memory index.
- `PROJECT_MEMORY.zh-CN.md`: Chinese project memory.
- `PROJECT_MEMORY.en-US.md`: English project memory.
- `docs/PROJECT_BACKGROUND.md`: project background index.
- `docs/PROJECT_BACKGROUND.zh-CN.md`: Chinese project background.
- `docs/PROJECT_BACKGROUND.en-US.md`: English project background.
- `skills/personal-agent-project/`: project-specific Codex skill for future work on this repository.

