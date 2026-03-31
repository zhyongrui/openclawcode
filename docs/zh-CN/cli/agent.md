---
read_when:
  - 你想从脚本运行一个智能体回合（可选发送回复）
summary: "`openclaw agent` 的 CLI 参考（通过 Gateway 网关发送一个智能体回合）"
title: agent
x-i18n:
  generated_at: "2026-02-03T07:44:38Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: dcf12fb94e207c68645f58235792596d65afecf8216b8f9ab3acb01e03b50a33
  source_path: cli/agent.md
  workflow: 15
---

# `openclaw agent`

通过 Gateway 网关运行智能体回合（使用 `--local` 进行嵌入式运行）。使用 `--agent <id>` 直接指定已配置的智能体。

相关内容：

- 智能体发送工具：[Agent send](/tools/agent-send)

## 示例

```bash
openclaw agent --to +15555550123 --message "status update" --deliver
openclaw agent --agent ops --message "Summarize logs"
openclaw agent --session-id 1234 --message "Summarize inbox" --thinking medium
openclaw agent --session-key agent:main:main --message "Continue from the latest background task state."
openclaw agent --agent ops --message "Investigate flaky tests" --background
openclaw agent --agent ops --message "Generate report" --deliver --reply-channel slack --reply-to "#reports"
```

## 说明

- `--background` 仅支持通过 Gateway 网关执行的运行。命令会在收到 accepted 确认后立即返回，并打印 `agent.wait` 与会话恢复命令。
- 当你需要直接命中或恢复一个稳定会话键时，可使用 `--session-key <key>`，而不是依赖 `--to` 或 `--session-id` 路由。
