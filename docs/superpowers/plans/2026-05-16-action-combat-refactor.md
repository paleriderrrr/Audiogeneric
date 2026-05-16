# Action Combat Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild boss rules and player combat so battles feel like readable action-game melee encounters instead of hidden-range template loops.

**Architecture:** Keep the runtime contract centered on chronological behavior modules, but generate those modules from richer per-segment preset pools and beat-group micro phases. Replace implicit melee and dash logic in combat with explicit slash-cone and dodge-action state that rendering can visualize cleanly.

**Tech Stack:** TypeScript, browser Web Audio API, Canvas 2D runtime, Node test runner

---

### Task 1: Rule Preset Refactor

**Files:**
- Modify: `C:/2Projects/260424 Audiogeneric/src/behavior/types.ts`
- Modify: `C:/2Projects/260424 Audiogeneric/src/behavior/rules.ts`
- Modify: `C:/2Projects/260424 Audiogeneric/src/behavior/factory.ts`
- Test: `C:/2Projects/260424 Audiogeneric/tests/behavior-strategy.test.ts`

- [ ] **Step 1: Write failing tests for preset variation and micro-phase expansion**

Add tests that prove:
- one segment label can generate more than one attack/movement shape depending on context
- long sections expand into multiple micro phases with different roles
- the same preset is not repeated forever inside a long high-energy section

- [ ] **Step 2: Run the targeted behavior tests and verify failure**

Run: `npm test -- --test-name-pattern=\"preset|micro|phase|chorus|drop\"`

Expected: FAIL because current rule generation lacks preset pools and role-aware expansion.

- [ ] **Step 3: Implement richer rule generation**

Add per-label preset pools, selection history, and micro-phase expansion while preserving a flat runtime timeline.

- [ ] **Step 4: Re-run behavior tests**

Run: `npm test -- tests/behavior-strategy.test.ts`

Expected: PASS

### Task 2: Dodge Action Refactor

**Files:**
- Modify: `C:/2Projects/260424 Audiogeneric/src/core/combat.ts`
- Modify: `C:/2Projects/260424 Audiogeneric/src/game/runtime.ts`
- Test: `C:/2Projects/260424 Audiogeneric/tests/combat.test.ts`

- [ ] **Step 1: Write failing dodge tests**

Add tests that prove:
- dodge travels a stable action distance instead of just scaling move speed
- beat dodge grants longer invulnerability
- beat dodge clears bullets intersecting the traveled path
- normal dodge does not clear bullets

- [ ] **Step 2: Run the targeted combat tests and verify failure**

Run: `npm test -- --test-name-pattern=\"dodge|invulnerable|clear\"`

Expected: FAIL because current dodge is only a speed multiplier.

- [ ] **Step 3: Implement explicit dodge state**

Introduce fixed-distance dodge motion, beat-enhanced invulnerability, and path-based projectile clearing events.

- [ ] **Step 4: Re-run combat tests**

Run: `npm test -- tests/combat.test.ts`

Expected: PASS

### Task 3: Cone Slash Attack Refactor

**Files:**
- Modify: `C:/2Projects/260424 Audiogeneric/src/core/combat.ts`
- Modify: `C:/2Projects/260424 Audiogeneric/src/game/runtime.ts`
- Test: `C:/2Projects/260424 Audiogeneric/tests/combat.test.ts`

- [ ] **Step 1: Write failing slash tests**

Add tests that prove:
- attack hits bosses inside radius and cone angle
- attack misses bosses outside radius
- attack misses bosses outside facing cone
- beat timing boosts slash damage without changing range

- [ ] **Step 2: Run the targeted combat tests and verify failure**

Run: `npm test -- --test-name-pattern=\"slash|cone|angle|attack\"`

Expected: FAIL because current attack only checks distance.

- [ ] **Step 3: Implement explicit cone slash state**

Replace hidden melee distance checks with angle-aware slash hit logic and readable attack metadata for rendering.

- [ ] **Step 4: Re-run combat tests**

Run: `npm test -- tests/combat.test.ts`

Expected: PASS

### Task 4: Runtime Feedback And Final Verification

**Files:**
- Modify: `C:/2Projects/260424 Audiogeneric/src/game/runtime.ts`
- Modify: `C:/2Projects/260424 Audiogeneric/src/game/feedback.ts`
- Modify: `C:/2Projects/260424 Audiogeneric/src/styles.css`
- Test: `C:/2Projects/260424 Audiogeneric/tests/runtime.test.ts`

- [ ] **Step 1: Add failing tests if runtime coverage is insufficient**

Cover any new rendering-driven state transitions that can be validated in unit tests.

- [ ] **Step 2: Implement visual feedback**

Add slash cone visuals, dodge trail differentiation, and projectile-clear feedback.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: PASS

- [ ] **Step 4: Run the production build**

Run: `npm run build`

Expected: PASS
