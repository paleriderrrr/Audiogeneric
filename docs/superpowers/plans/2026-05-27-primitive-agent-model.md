# Primitive Agent Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a primitive-driven audio-to-behavior model where spectrum primitives are the lower layer and LLMs manage primitive structure.

**Architecture:** Add deterministic music primitive extraction, expose primitives to the behavior prompt, accept primitive plans from LLM providers, validate them, and compile them to the existing `BehaviorModule` timeline. Rule fallback uses the same compiler so both paths share one behavior semantics layer.

**Tech Stack:** TypeScript, Node test runner, existing Vite/TS build, existing behavior validation.

---

### Task 1: Audio Primitive Extraction

**Files:**
- Create: `src/audio/primitives.ts`
- Modify: `src/audio/types.ts`
- Modify: `src/audio/analysis-core.ts`
- Test: `tests/audio-primitives.test.ts`

- [ ] Write tests for low-heavy, bright, flux, dense, stable, and climax primitive extraction.
- [ ] Run `npm run test:tool -- audio-primitives` and verify it fails because the module does not exist.
- [ ] Implement `extractMusicPrimitives`.
- [ ] Wire `AudioAnalysis.primitives`.
- [ ] Run `npm run test:tool -- audio-primitives`.

### Task 2: Behavior Primitive Plan Types And Compiler

**Files:**
- Create: `src/behavior/primitives.ts`
- Modify: `src/behavior/types.ts`
- Test: `tests/behavior-primitive-plan.test.ts`

- [ ] Write tests for compiling bright-beam, bass-impact, and dense+bright coupled plans.
- [ ] Run `npm run test:tool -- behavior-primitive-plan` and verify it fails.
- [ ] Implement `PrimitivePlan`, `PrimitiveStep`, plan validation, default plan creation, and compiler.
- [ ] Run `npm run test:tool -- behavior-primitive-plan`.

### Task 3: Prompt And LLM Chain Integration

**Files:**
- Modify: `src/behavior/prompt.ts`
- Modify: `src/behavior/factory.ts`
- Modify: `src/behavior/mimo-provider.ts`
- Test: `tests/behavior-strategy.test.ts`
- Test: `tests/mimo-provider.test.ts`

- [ ] Write tests that prompt input includes primitive catalog and LLM primitive plans compile to behavior timelines.
- [ ] Run focused tests and verify they fail.
- [ ] Update prompt contract to prefer primitive plans.
- [ ] Update provider normalization to compile primitive plans and fall back when invalid.
- [ ] Update MiMo request payload to include primitive planning instructions.
- [ ] Run focused tests.

### Task 4: Full Verification

**Files:**
- No new files.

- [ ] Run `npm run test:tool -- audio-primitives behavior-primitive-plan behavior-strategy mimo-provider audio-pipeline`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.

