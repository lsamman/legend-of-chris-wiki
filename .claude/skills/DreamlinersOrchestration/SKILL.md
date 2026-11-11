---
name: DreamlinersOrchestration
description: Run a multi-part task as Fable orchestrating Opus, Sonnet and Haiku executors, spending tokens only where they help. Use when a task has real parts to split, or when the user invokes /DreamlinersOrchestration.
---

# DreamlinersOrchestration

Fable (this session) plans, briefs, reviews, commits, PRs and merges. Opus, Sonnet and Haiku execute. If the session is not running Fable, say once that `/model claude-fable-5-2` (with `/advisor fable`) puts Fable in charge, then proceed the same way.

## Tiers

| Tier | Use for |
|---|---|
| Haiku | Repetitive, fully specified work: bulk entries, link/path checks, renames, one edit across many files |
| Sonnet | Standard building and writing: articles, CSS, build wiring, checks |
| Opus | Hard or costly-if-wrong: engine/camera code, subtle bugs, close reading of source material |
| Fable | Plan, brief, review, polish, commit, PR, merge |

## Procedure

1. **Decide whether to split.** Default is doing it yourself. Spawn only when parallel work or a cheaper tier saves more than the brief and report cost. A one-file fix or a quick read is never spawned.
2. **Split into independent parts.** Group similar small jobs into one Haiku task. Parts that touch the same files get `isolation: "worktree"`.
3. **Pick the cheapest capable tier** per part. Move up one tier only after a failure.
4. **Brief** each executor with the Brief template below. Point at files; never paste them. Never use `fork`.
5. **Run in parallel, in the background.** Wait for notifications; do not poll.
6. **Review each result:** `git diff --stat`, then only the hunks that matter, then the project's build and checks. Approve, polish small issues directly, or send it back by `SendMessage` to the same agent with specific notes (not a fresh spawn).
7. **Integrate:** Fable alone commits, pushes, opens the PR and merges when the user has authorised merging.
8. **Advisor** at two points only on multi-step work: plan lock-in and before declaring done. Skip it for small tasks.

## Brief template (keep under ~15 lines)

```
Task: <one sentence>
Files: <path:lines>, <path:lines>
Rules: <only the house rules that apply>
Done when: <checkable criteria>
Do not: commit, push, touch <paths>
Report: files changed (one line each); failures verbatim; nothing else.
```

## Token rules
- Short briefs, short reports, no narration, no file dumps.
- Executors return paths and line numbers; Fable does not re-explore them.
- Self-check screenshots at `deviceScaleFactor: 1`, only the frames that answer a question.
- Each `advisor()` call sends the whole transcript; use it sparingly.

## Using this skill elsewhere

In any other Claude Code session, copy it in once and it is available as `/DreamlinersOrchestration`:

```
mkdir -p ~/.claude/skills/DreamlinersOrchestration && curl -fsSL https://raw.githubusercontent.com/lsamman/legend-of-chris-wiki/main/.claude/skills/DreamlinersOrchestration/SKILL.md -o ~/.claude/skills/DreamlinersOrchestration/SKILL.md
```
