# Ollama — Workspace UI Experiment

This fork extends the original Ollama app with a **local workspace-aware agent UI**.

> 👉 Original project: https://github.com/ollama/ollama

---

## Workspace UI POC

![Workspace UI POC](workspace-ui-poc/workspace_ui_wip.png)
---

## What’s added

- Local workspace explorer (VS Code–style)
- File-aware chat (selected file + guidance context)
- Guidance chain detection (`START_HERE.md`, `AGENTS.md`, `context.md`, etc.)
- Patch proposal system (`@patch`)
- Safe apply (review → approve → write)
- Recent workspace memory

---

## Status

Prototype / experimental branch (`workspace-ui`)

## Example workflow

1. Open a workspace folder
2. Select a file
3. Ask: `@ask explain this file`
4. Plan: `@plan refactor this logic`
5. Propose change: `@patch add validation`
6. Review → Apply patch