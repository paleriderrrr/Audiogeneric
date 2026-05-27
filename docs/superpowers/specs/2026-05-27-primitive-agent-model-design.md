# Primitive Agent Model Design

## Goal

Optimize the spectrum-analysis and LLM-driven behavior chain by making music primitives the stable lower layer and letting the LLM manage primitive structure rather than raw combat parameters.

## Research Basis

The design follows common LLM-agent patterns from ReAct, Toolformer, Reflexion, Voyager, AutoGen, MetaGPT, and LLM game-agent surveys: constrain the model with a small action/tool space, validate intermediate plans, keep executable behavior deterministic, and use feedback/fallback paths when model output is invalid.

## Architecture

`AudioAnalysis` gains a `primitives` array. A deterministic spectrum primitive extractor maps segment FFT features into `MusicPrimitive` items such as `bass-impact`, `bright-beam`, `flux-break`, `dense-pressure`, `stable-groove`, and `climax`.

The behavior layer introduces `PrimitivePlan` and `PrimitiveStep`. LLM providers may return a primitive plan instead of directly returning `BehaviorModule` values. The local compiler validates primitive references and compiles the plan into the existing `BehaviorTimeline` contract. Rule fallback also uses generated primitive plans, so LLM and rules share one bottom layer.

## Data Flow

1. Audio decoding and FFT analysis produce segments and segment features.
2. `extractMusicPrimitives` scores each segment for primitive kinds.
3. `buildBehaviorPromptInput` exposes the primitive catalog and requires LLMs to compose primitive steps.
4. `normalizeProviderResult` accepts either a final behavior timeline or a primitive plan.
5. `compilePrimitivePlan` deterministically maps primitive steps to `BehaviorModule` values.
6. `validateBehaviorTimeline` remains the runtime safety gate.

## Scope

This pass keeps runtime combat unchanged. It only changes audio analysis, behavior generation, provider prompts, and tests.

