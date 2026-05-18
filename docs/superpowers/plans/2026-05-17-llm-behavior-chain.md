# LLM Behavior Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-model-ready behavior generation chain that sends richer music features and style-aware combat guidance to an LLM provider while preserving rule fallback.

**Architecture:** Extend audio analysis with deterministic style and segment features. Add a pure behavior prompt payload builder and parser/normalizer layer around the existing provider interface. Keep runtime consuming `BehaviorTimeline` so real API integration can be added later without changing combat code.

**Tech Stack:** TypeScript, Vite, Node test runner, browser Web Audio API, existing behavior timeline schema.

---

### Task 1: Audio Style Feature Model

**Files:**
- Modify: `src/audio/types.ts`
- Modify: `src/audio/pipeline.ts`
- Modify: `src/audio/analyzer.ts`
- Test: `tests/audio-pipeline.test.ts`

- [ ] Add failing tests proving electronic and rock-like frame summaries produce distinct `styleProfile` values and segment features.
- [ ] Implement `inferTrackStyleProfile` and include `styleProfile` plus `segmentFeatures` in `AudioAnalysis`.
- [ ] Run `npm test`.

### Task 2: Prompt Payload And Parsing Layer

**Files:**
- Modify: `src/behavior/types.ts`
- Create: `src/behavior/prompt.ts`
- Modify: `src/behavior/factory.ts`
- Test: `tests/behavior-strategy.test.ts`

- [ ] Add failing tests proving prompt payload includes style, global features, segment features, available tactics, and design rules.
- [ ] Add failing tests proving string JSON responses from a mock provider parse into a validated timeline.
- [ ] Implement prompt payload builder and provider result normalization.
- [ ] Run `npm test`.

### Task 3: Style-Aware Strategy Mapping

**Files:**
- Modify: `src/behavior/rules.ts`
- Modify: `src/behavior/validate.ts`
- Test: `tests/behavior-strategy.test.ts`
- Test: `tests/behavior.test.ts`

- [ ] Add failing tests proving rock favors larger warning/ring pressure and electronic favors fast fire windows/lane or aimed bursts.
- [ ] Implement style modifiers in rule fallback and validate style metadata from LLM timelines.
- [ ] Run `npm test`, `npm run build`, `npm audit --json`, and dev smoke.
