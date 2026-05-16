# Action Combat Refactor Design

**Date:** 2026-05-16

**Goal**

Rework the combat loop so the boss feels less template-driven, dodging feels decisive, and player attacks become readable and intentional. The new target is an action-game style melee flow built around visible cone attacks, beat-enhanced dodge invulnerability, and richer rule presets per music segment.

## Context

The current combat loop works end-to-end, but three parts remain too flat:

1. Rule generation mostly maps one music segment to one behavior template, so long sections can feel repetitive.
2. Dodge currently behaves like a speed spike rather than a committed action move, so it lacks force and clarity.
3. Attack resolution is mostly hidden distance checking, so the player cannot clearly read their attack reach or angle.

## Design Summary

The refactor introduces three linked changes:

1. Segment-driven boss behavior becomes a preset-pool system with beat-group micro phases.
2. Dodge becomes a fixed-distance action move with base invulnerability and beat-enhanced projectile clearing.
3. Attack becomes a visible cone slash with explicit range, angle, and hit timing.

## Boss Rule System

### Segment Preset Pools

Each music segment label keeps its high-level role, but no longer maps to a single default pattern. Instead, each label owns a preset pool. A preset describes:

- dominant combat intent
- movement mode sequence
- attack mode sequence
- preferred beat group size
- recovery cadence
- pressure bounds

Examples:

- `intro`: static probe, low-density ring, light pursuit
- `verse`: lateral pressure, aimed poke, reposition then burst, chase then recover
- `bridge`: orbit windup, feint pressure, focused pursuit
- `chorus`: spread burst, lane pressure, dense aimed burst, center compression
- `drop`: burst wave, lockdown lane sweep, rapid reposition burst, high pressure then release
- `outro`: low-pressure cleanup, fading ring, retreating pressure

### Micro-Phase Expansion

Each segment is expanded into smaller beat-group modules instead of one long module. Every micro phase receives one role:

- `setup`
- `pressure`
- `burst`
- `reposition`
- `recovery`

This keeps the boss readable while reducing repetition. A long chorus can alternate between pressure and reposition instead of looping one attack for the whole section.

### Selection Rules

Preset selection is informed by:

- segment label
- segment energy
- segment duration
- BPM band
- energy delta from previous segment
- previous preset history

To keep the fight fair:

- the same preset should not repeat too often in a row
- high-pressure phases must be followed by reposition or recovery within a bounded window
- low-pressure songs must still receive at least one actionable preset across the timeline

## Player Dodge

### Core Feel

Dodge becomes a committed action with:

- fixed travel distance
- short recovery tail
- base invulnerability
- cooldown gate

If no movement input is held, dodge uses current facing direction so it still feels responsive.

### Beat Enhancement

Beat-aligned dodge keeps the same travel distance but gains:

- longer invulnerability
- stronger visual feedback
- projectile clearing along the dodge path

Projectile clearing is local to the traveled path rather than global. The player should carve a safe lane, not reset the whole arena.

### Combat Value

This makes dodge useful both as defense and as rhythm-based space control:

- normal dodge: reposition and survive
- beat dodge: survive longer and open a route through bullets

## Player Attack

### Cone Slash

Primary attack becomes a visible forward cone slash. Boss hits require:

- target within attack radius
- target inside slash cone angle
- active hit frame reached

Attack should have a short startup, active hit window, and short recovery so it reads like a deliberate melee action.

### Readability

The slash displays a brief cone arc and range shape when used. This makes the attack distance and angle legible without adding lock-on automation.

### Rhythm Link

Beat timing still boosts damage and feedback, but does not change attack range. Range and angle stay stable so the move remains learnable.

### Supportive Hinting

When the boss is inside attackable range, the UI may show a subtle cue near the reticle or boss outline. This is only a readability hint, not aim assist.

## Data And Runtime Impact

### Behavior Types

`BehaviorModule` will need enough information to express preset variation and micro-phase role. The runtime still consumes a flat, chronological module list.

### Combat State

Player state will need explicit dodge state and slash state instead of relying on movement speed spikes and hidden short-range attack checks.

Likely additions:

- dodge direction / progress
- dodge clearing state
- attack cone radius
- attack cone angle
- attack active timing

### Rendering

Runtime rendering will need:

- dodge trail differentiation between normal and beat-enhanced dodge
- projectile clear effects along dodge path
- slash cone VFX
- attack range/readability cues

## Testing Strategy

Tests should focus on behavior and fairness:

- rule generation creates varied presets inside the same segment label
- long segments expand into multiple micro phases
- repeated presets are bounded
- dodge travels fixed distance even without movement input
- beat dodge extends invulnerability and clears bullets on path
- normal dodge does not clear bullets
- cone slash hits only inside radius and angle
- cone slash misses targets behind or outside cone

## Scope

This refactor intentionally does not add:

- target lock systems
- combo chains
- new weapon classes
- new LLM behavior generation surfaces

The goal is to deepen the existing combat loop without changing the overall product shape.
