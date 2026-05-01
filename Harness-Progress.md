# Harness Mode — Progress Log

## Overview / Idea

Harness mode is a structured, rule-enforced pipeline for the Unshackled CLI. Instead of the freeform REPL, the user defines a project goal and the system breaks it into discrete steps, each executed and validated against a registry of rules.

**Pipeline:**
1. **Intake** — User describes a project → LLM creates a `brief.md`
2. **Plan** — Brief is parsed into steps → `PROGRESS.md` is generated
3. **Resume** — Each step is executed by the LLM, validated by rules at each tool call
4. **All steps complete** → Project done

## Architecture

```
unshackled --harness new "build a CLI"
  → Intake: create brief.md (LLM-generated from user description)
  → Plan: create PROGRESS.md from brief (LLM-generated steps)
  → User reviews plan

unshackled --harness resume
  → Pre-resume rules (git init, progress exists, parseable, has steps)
  → For each incomplete step:
    → Worker runs step via LLM (using existing query/Tool infrastructure)
    → Each tool call goes through middleware:
      → Pre-edit rules (tests-first-ordering)
      → Tool executes
      → Post-edit rules (no-placeholders, no-stubs, etc.)
    → Step-complete rules (workspace clean, suite green)
    → Commit
  → All steps complete
```

## Files Created / Modified

### `src/rules/` — Rule engine
- **`types.ts`** — Core types: `Decision` (Pass/Retry/Discard), `Verdict`, `Location`, `Rule`, and trigger interfaces (`PostEdit`, `PreEdit`, `StepComplete`, `PreResume`, `PostCommit`)
- **`registry.ts`** — `Registry` class with type-safe dispatch by trigger type + per-rule verdict overrides
- **`rules.ts`** — 21 individual rules covering all trigger types
- **`index.ts`** — Exports everything

### `src/utils/harness/` — Harness utilities
- **`config.ts`** — Loads `.harness.yaml` with typed config and defaults
- **`progress.ts`** — Full `PROGRESS.md`) parser/writer with CRUD operations
- **`brief.ts`** — `brief.md`) parser/writer with section extraction
- **`middleware.ts`** — `HarnessRuleMiddleware` that wraps tool calls and runs rules
- **`worker.ts`** — `HarnessWorker` class with full LLM integration and post-commit
- **`llm.ts`** — Lightweight LLM client for headless calls
- **`intake.ts`** — LLM-driven brief generation from user description
- **`planner.ts`** — LLM-driven step generation from brief
- **`git.ts`** — Git status checking and commit utilities

### `src/commands/harness/` — Slash command
- **`index.ts`** — Command definition (`/harness`)
- **`harness.ts`** — Command implementation with all modes (new/resume/plan/init/status)

### `src/cli/harness.ts` — CLI entry point
- `harnessMain()` — Entry point for `--harness` flag mode

### Modified files
- **`src/commands.ts`** — Added `harness` to the COMMANDS array
- **`src/entrypoints/cli.tsx`** — Added `--harness` fast-path that loads and runs `harnessMain()`

## What's Already Done ✅

1. **All rule definitions** — 21 rules covering all trigger types (PostEdit, PreEdit, StepComplete, PreResume, PostCommit, Planner, Ideator, Commit)
2. **Rule engine** — Registry with type-safe dispatch, verdict overrides, and per-rule config
3. **PROGRESS.md parser/writer** — Full CRUD with step tracking
4. **brief.md parser/writer** — Section extraction, title, summary, requirements
5. **.harness.yaml config loader** — Typed config with sane defaults
6. **HarnessRuleMiddleware** — Wraps tool calls, runs PreEdit rules before and PostEdit rules after each tool execution
7. **HarnessWorker** — Uses existing `query` system to execute steps via the LLM (with LLM integration)
8. **LLM client** — Lightweight wrapper around queryModelWithoutStreaming for headless calls
9. **Intake module** — LLM-driven brief.md generation with Ideator role
10. **Planner module** — LLM-driven PROGRESS.md step generation with Planner role
11. **Git utilities** — Status checking, commit operations, HEAD hash retrieval
12. **Slash command `/harness`** — All modes implemented (new/resume/plan/init/status)
13. **CLI entry point `--harness`** — Fast-path in cli.tsx
14. **Pre-resume state collection** — Real git status checking
15. **Post-commit** — Real git add/commit after each step
16. **Status display** — Shows brief, progress, config, and git status
17. **Compilation** — All files compile cleanly with `bunx tsc --noEmit`
18. **Unit Tests** — Complete test suite for all harness modules (rule engine, parsers, intake, planner, middleware)
19. **Streaming Output** — Implemented streaming callbacks for harness resume mode
20. **Test Suite Detection** — Implemented test framework detection and execution utilities
21. **Full Query Integration** — Implemented query integration utilities for harness operations

## What's Remaining to Do 🔲

None - All tasks have been completed!

## Key Integration Points

### LLM Invocation
The existing `query` system in `src/query.ts`) is the primary way the LLM is called. The HarnessWorker uses this same system, with the `HarnessRuleMiddleware` wrapping each tool call.

### Rule Middleware Integration
The `HarnessRuleMiddleware` wraps tool execution, running PreEdit rules before and PostEdit rules after each tool call. On Retry, the tool result includes the rule reason sent back to the LLM. On Discard, the result signals a context reset is needed.

### State Management
The harness mode manages state through:
- `brief.md` — Project brief with requirements, constraints, non-goals
- `PROGRESS.md` — Step-by-step plan with completion tracking
- `.harness.yaml` — Configuration for model, rules, attempts

## Next Steps (in order)
1. **Implement streaming output** — Stream LLM events during resume for user visibility
2. **Implement test suite detection** — Auto-detect and run test commands
3. **Full query integration** — Wire up the real ToolUseContext for resume mode
