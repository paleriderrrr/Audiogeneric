# Audio And Behavior Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the audio ingestion pipeline around hidden warmup calibration and refactor behavior generation into configurable rule-driven and optional LLM-driven timelines.

**Architecture:** Split the audio path into pure analysis stages plus a warmup calibration controller that the UI can drive without exposing technical tuning. Split behavior generation into profiles, modifiers, timeline assembly, and strategy selection so runtime consumes one normalized timeline regardless of source.

**Tech Stack:** TypeScript, Vite, browser Web Audio API, Node test runner, Canvas runtime

---

### Task 1: Audio Core Pipeline

**Files:**
- Create: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/src/audio/types.ts`
- Create: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/src/audio/calibration.ts`
- Create: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/src/audio/pipeline.ts`
- Modify: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/src/audio/analyzer.ts`
- Test: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/tests/audio-pipeline.test.ts`

- [ ] Write failing tests for tempo candidates, warmup window selection, and tap-based calibration.
- [ ] Run `npm test` and verify the new audio tests fail because the pipeline types/functions do not exist.
- [ ] Implement the minimal pure audio pipeline and calibration helpers.
- [ ] Run `npm test` and verify audio tests pass.

### Task 2: Behavior Strategy Core

**Files:**
- Create: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/src/behavior/types.ts`
- Create: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/src/behavior/profiles.ts`
- Create: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/src/behavior/rules.ts`
- Create: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/src/behavior/validate.ts`
- Create: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/src/behavior/factory.ts`
- Modify: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/src/core/behavior.ts`
- Test: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/tests/behavior-strategy.test.ts`

- [ ] Write failing tests for rule profiles, long-segment expansion, and explicit LLM fallback behavior.
- [ ] Run `npm test` and verify the new behavior strategy tests fail for the expected missing exports.
- [ ] Implement the behavior strategy modules and compatibility wrapper.
- [ ] Run `npm test` and verify behavior strategy tests pass.

### Task 3: Runtime And UI Integration

**Files:**
- Modify: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/src/main.ts`
- Modify: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/src/game/runtime.ts`
- Modify: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/src/core/combat.ts`
- Modify: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/src/styles.css`
- Test: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/tests/combat.test.ts`

- [ ] Add failing tests for normalized behavior timeline consumption if existing combat coverage is insufficient.
- [ ] Run `npm test` to verify the integration assertions fail before code changes.
- [ ] Wire the hidden warmup flow into the UI and connect runtime to the unified behavior factory output.
- [ ] Run `npm test` and verify all tests pass.

### Task 4: Verification

**Files:**
- Modify: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/src/main.ts`
- Modify: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/src/audio/analyzer.ts`
- Modify: `E:/LargeScaleTestArea/Audiogeneric/audiogenic_web_refactor/src/game/runtime.ts`

- [ ] Run `npm test` and verify the full suite is green.
- [ ] Run `npm run build` and verify production build succeeds.
- [ ] Start the dev server and verify the app serves successfully.
