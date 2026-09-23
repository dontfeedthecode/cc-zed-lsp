---
name: demo-skill
description: Demonstrates what the language server catches. Open this in Zed.
version: 1.0.0
tools: Read, Grep
effort: extreme
agent: Explore
compatibility: fine
---

Four of the lines above the fence are flagged:

- `version` is a hint — real skills use it, Claude Code ignores it.
- `tools` is a warning — that is subagent frontmatter; skills use `allowed-tools`.
- `effort: extreme` is an error — not one of the five accepted levels.
- `agent` is a warning — inert without `context: fork`.

`name`, `description` and `compatibility` are correct and stay quiet, which is the other half of the
point: the checks are chosen so the squiggles stay worth reading.

Put the caret after `effort: ` and trigger completion to see the five levels.
