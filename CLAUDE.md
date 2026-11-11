# How Claude works in this repo

The owner wants work split by model: **Fable orchestrates, Opus and Sonnet execute, Haiku handles
repetitive work, and Fable reviews everything before it lands.** Follow this in every session.

The session's main model is the orchestrator. If the session is not running Fable, mention once that
`/model claude-fable-5-2` (with `/advisor fable`) puts Fable in charge, then follow the same split.

## Who does what

| Model | Gets |
|---|---|
| **Fable** (main session) | Planning, splitting the work, writing each brief, reviewing every result, final polish, commits, PRs, merges |
| **Opus** (Agent `model: "opus"`) | Hard reasoning, design, tricky bugs, anything where a subtle mistake is expensive: the flythrough's camera and 3D code, scroll-sync bugs, reading the canon closely to place events, multi-file refactors of `build/build.py` |
| **Sonnet** (Agent `model: "sonnet"`) | Solid, standard implementation and writing: new articles in the house voice, CSS and layout, wiring a page into the build, Playwright checks, README updates |
| **Haiku** (Agent `model: "haiku"`) | Simple, repetitive, well-specified bulk work: filling entries from a finished mapping, checking every link or image path, renames, inventories, one known edit across many files |

## Rules

1. **Fable briefs.** Each subagent gets a self-contained brief: the goal, the files by path, the
   house rules that apply (IIFE and `var` in front-end JS, `[[slug|label]]` links, the content limits
   in `build/WRITER_GUIDE.md`), what "done" means, and what not to touch.
2. **Executors do not commit, push or merge.** They return their changes and a short report; Fable
   integrates.
3. **Independent tasks run in parallel.** Executors that would edit the same files work in separate
   worktrees (`isolation: "worktree"`), and Fable merges the results.
4. **Fable reviews every result before it lands.** Read the diff, run `python3 build/build.py` and the
   relevant checks, then approve it, polish small issues directly, or send it back with specific notes.
5. **Escalation.** A Haiku or Sonnet task that fails twice is re-run one tier up. Opus is the top
   executor tier.
6. **Consult `advisor()`** before locking a plan, before anything hard to reverse, when stuck, and
   before declaring done.
7. **Small jobs stay single-handed.** A one-line fix or a quick read is done directly; splitting is
   for work with real parts.

## Repo basics

- `python3 build/build.py` regenerates `site/` (committed; GitHub Pages deploys it on push to `main`).
  Never hand-edit `site/`.
- Content lives in `content/` (articles, timeline, groups, tour, images). See `README.md`.
