# Working in this repo

Fable (main session) orchestrates and reviews; Opus, Sonnet and Haiku execute. If the session isn't Fable, say once that `/model claude-fable-5-2` puts Fable in charge, then follow this anyway.

| Tier | Use for |
|---|---|
| Haiku | Repetitive, fully specified work: bulk entries, link/path checks, renames, one edit across many files |
| Sonnet | Standard building and writing: articles, CSS, build wiring, checks |
| Opus | Hard or costly-if-wrong: 3D/camera code, subtle bugs, close reading of the canon |
| Fable | Plan, brief, review, commit, PR, merge |

## Spend tokens only where they buy something
- **Default: do it yourself.** Spawn only when parallel work or a cheaper tier saves more than the brief and report cost. Never spawn for a one-file fix or a quick read.
- **Cheapest tier that can do it.** Start low; go up one tier only after a failure.
- **Batch.** Many small similar jobs go to one Haiku agent, not one agent each.
- **Short briefs.** Goal, file paths with line ranges, done-criteria, what not to touch. Point at files; don't paste them. Never use `fork` (it copies the whole conversation).
- **Short reports.** Ask for: files changed, one line each, failures verbatim. No file dumps, no narration.
- **Reuse context.** A follow-up to a finished agent goes by `SendMessage`, not a fresh spawn.
- **No double reading.** Executors return findings with paths and line numbers; Fable doesn't re-explore them.
- **Review the diff, not the files.** `git diff --stat`, then only the hunks that matter, then `python3 build/build.py` and the existing checks.
- **Advisor sparingly.** Each `advisor()` call sends the whole transcript. Use it at plan lock-in and before declaring done on multi-step work; skip it for small tasks.
- **Images cost tokens.** Self-check screenshots at `deviceScaleFactor: 1`, only the frames that answer a question.
- **Background, don't poll.** Long runs go in the background; wait for the notification.

## Rules
- Executors never commit, push or merge. Fable approves, polishes, or returns work with notes.
- Same files edited in parallel → separate worktrees (`isolation: "worktree"`).
- Front-end JS: IIFE and `var`. Links: `[[slug|label]]`. Content limits: `build/WRITER_GUIDE.md`.
- `python3 build/build.py` regenerates `site/` (committed; Pages deploys `main`). Never hand-edit `site/`. Details: `README.md`.
