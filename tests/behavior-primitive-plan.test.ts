import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compilePrimitivePlan,
  createDefaultPrimitivePlan,
  validatePrimitivePlan
} from '../src/behavior/primitives.js';
import type { BehaviorGenerationInput, PrimitivePlan } from '../src/behavior/types.js';

const input: BehaviorGenerationInput = {
  bpm: 140,
  difficulty: 1.5,
  beatGrid: Array.from({ length: 80 }, (_, index) => index * 0.5),
  downbeat: 0,
  segments: [
    { start: 0, end: 10, label: 'verse', energy: 0.6, lowFreqWeight: 0.62, highFreqWeight: 0.18, stability: 0.7, intensity: 0.66 },
    { start: 10, end: 22, label: 'chorus', energy: 0.86, lowFreqWeight: 0.18, highFreqWeight: 0.68, spectralCentroid: 0.76, spectralFlux: 0.62, beatDensity: 0.84, stability: 0.52, intensity: 0.9 },
    { start: 22, end: 36, label: 'drop', energy: 0.96, lowFreqWeight: 0.54, highFreqWeight: 0.58, spectralFlux: 0.82, beatDensity: 0.94, stability: 0.42, intensity: 0.98 }
  ],
  primitives: [
    { id: 'p0-bass-impact', kind: 'bass-impact', start: 0, end: 10, segmentIndex: 0, strength: 0.84, confidence: 0.82, features: { energy: 0.6, lowFreqWeight: 0.62, highFreqWeight: 0.18, spectralFlux: 0.2, beatDensity: 0.66, stability: 0.7, intensity: 0.66 } },
    { id: 'p1-bright-beam', kind: 'bright-beam', start: 10, end: 22, segmentIndex: 1, strength: 0.9, confidence: 0.86, features: { energy: 0.86, lowFreqWeight: 0.18, highFreqWeight: 0.68, spectralFlux: 0.62, beatDensity: 0.84, stability: 0.52, intensity: 0.9 } },
    { id: 'p2-dense-pressure', kind: 'dense-pressure', start: 22, end: 36, segmentIndex: 2, strength: 0.94, confidence: 0.9, features: { energy: 0.96, lowFreqWeight: 0.54, highFreqWeight: 0.58, spectralFlux: 0.82, beatDensity: 0.94, stability: 0.42, intensity: 0.98 } },
    { id: 'p2-climax', kind: 'climax', start: 22, end: 36, segmentIndex: 2, strength: 0.98, confidence: 0.92, features: { energy: 0.96, lowFreqWeight: 0.54, highFreqWeight: 0.58, spectralFlux: 0.82, beatDensity: 0.94, stability: 0.42, intensity: 0.98 } }
  ],
  confidence: {
    overall: 0.9,
    segmentation: 0.82,
    tempo: 0.94
  }
};

test('creates a default primitive plan from available music primitives', () => {
  const plan = createDefaultPrimitivePlan(input);

  assert.equal(plan.source, 'primitive-plan');
  assert.equal(plan.steps.length <= (input.primitives?.length ?? 0), true);
  assert.equal(plan.steps[0].primitiveIds.includes('p0-bass-impact'), true);
  assert.equal(plan.steps.some((step) => step.coupling === 'layered' || step.coupling === 'climax'), true);
});

test('validates primitive plans against the available primitive catalog', () => {
  const validation = validatePrimitivePlan({
    source: 'primitive-plan',
    generatedAt: 1,
    steps: [
      { id: 'bad-step', start: 0, end: 4, primitiveIds: ['missing'], intent: 'burst', phaseRole: 'burst', coupling: 'single', intensity: 0.8 }
    ],
    metadata: { modelName: 'unit-test' }
  }, input);

  assert.equal(validation.valid, false);
  assert.equal(validation.warnings.some((warning) => warning.includes('Unknown primitive id')), true);
});

test('rejects primitive plans that leave gaps inside analyzed segments', () => {
  const validation = validatePrimitivePlan({
    source: 'primitive-plan',
    generatedAt: 1,
    steps: [
      { id: 'bass-step', start: 0, end: 10, primitiveIds: ['p0-bass-impact'], intent: 'chase', phaseRole: 'pressure', coupling: 'single', intensity: 0.72 },
      { id: 'drop-step', start: 22, end: 36, primitiveIds: ['p2-climax'], intent: 'burst', phaseRole: 'burst', coupling: 'climax', intensity: 0.96 }
    ],
    metadata: { modelName: 'unit-test' }
  }, input);

  assert.equal(validation.valid, false);
  assert.equal(validation.warnings.some((warning) => warning.includes('Gap between primitive steps')), true);
});

test('rejects primitive plans that do not cover the analyzed song range', () => {
  const validation = validatePrimitivePlan({
    source: 'primitive-plan',
    generatedAt: 1,
    steps: [
      { id: 'late-step', start: 10, end: 22, primitiveIds: ['p1-bright-beam'], intent: 'lockdown', phaseRole: 'burst', coupling: 'single', intensity: 0.86 }
    ],
    metadata: { modelName: 'unit-test' }
  }, input);

  assert.equal(validation.valid, false);
  assert.equal(validation.warnings.some((warning) => warning.includes('Primitive plan must start')), true);
  assert.equal(validation.warnings.some((warning) => warning.includes('Primitive plan must end')), true);
});

test('compiles primitive plans to existing behavior modules', () => {
  const plan: PrimitivePlan = {
    source: 'primitive-plan',
    generatedAt: 123,
    steps: [
      { id: 'bass-step', start: 0, end: 10, primitiveIds: ['p0-bass-impact'], intent: 'chase', phaseRole: 'pressure', coupling: 'single', intensity: 0.72 },
      { id: 'beam-step', start: 10, end: 22, primitiveIds: ['p1-bright-beam'], intent: 'lockdown', phaseRole: 'burst', coupling: 'single', intensity: 0.88 },
      { id: 'climax-step', start: 22, end: 36, primitiveIds: ['p2-dense-pressure', 'p2-climax'], intent: 'burst', phaseRole: 'burst', coupling: 'climax', intensity: 0.98 }
    ],
    metadata: { modelName: 'unit-test' }
  };

  const timeline = compilePrimitivePlan(plan, input, { source: 'llm', fallbackUsed: false, warnings: [] });
  const attacks = new Set(timeline.modules.map((module) => module.attack));

  assert.equal(timeline.source, 'llm');
  assert.equal(timeline.metadata.modelName, 'unit-test');
  assert.equal(attacks.has('charge-strike') || attacks.has('ground-slam'), true);
  assert.equal(attacks.has('laser-ray') || attacks.has('laser-barrage'), true);
  assert.equal(timeline.modules.some((module) => module.attack === 'laser-barrage' || module.attack === 'charge-sweep'), true);
  assert.equal(timeline.modules.every((module) => module.presetId.includes('primitive')), true);
});

test('varies repeated bass primitives across segments instead of repeating one boss action', () => {
  const bassInput: BehaviorGenerationInput = {
    ...input,
    segments: [
      { start: 0, end: 12, label: 'intro', energy: 0.54 },
      { start: 12, end: 28, label: 'verse', energy: 0.68 },
      { start: 28, end: 44, label: 'bridge', energy: 0.74 },
      { start: 44, end: 64, label: 'chorus', energy: 0.86 }
    ],
    primitives: [
      { id: 'b0', kind: 'bass-impact', start: 0, end: 12, segmentIndex: 0, strength: 0.64, confidence: 0.8, features: { energy: 0.54, lowFreqWeight: 0.6, highFreqWeight: 0.12, spectralFlux: 0.18, beatDensity: 0.62, stability: 0.72, intensity: 0.62 } },
      { id: 'b1', kind: 'bass-impact', start: 12, end: 28, segmentIndex: 1, strength: 0.72, confidence: 0.82, features: { energy: 0.68, lowFreqWeight: 0.66, highFreqWeight: 0.14, spectralFlux: 0.26, beatDensity: 0.7, stability: 0.68, intensity: 0.72 } },
      { id: 'b2', kind: 'bass-impact', start: 28, end: 44, segmentIndex: 2, strength: 0.78, confidence: 0.84, features: { energy: 0.74, lowFreqWeight: 0.7, highFreqWeight: 0.16, spectralFlux: 0.34, beatDensity: 0.76, stability: 0.58, intensity: 0.8 } },
      { id: 'b3', kind: 'bass-impact', start: 44, end: 64, segmentIndex: 3, strength: 0.86, confidence: 0.88, features: { energy: 0.86, lowFreqWeight: 0.74, highFreqWeight: 0.18, spectralFlux: 0.42, beatDensity: 0.84, stability: 0.5, intensity: 0.9 } }
    ]
  };
  const plan = createDefaultPrimitivePlan(bassInput);

  const timeline = compilePrimitivePlan(plan, bassInput, { source: 'rules', fallbackUsed: false, warnings: [] });
  const attacks = new Set(timeline.modules.map((module) => module.attack));
  const movements = new Set(timeline.modules.map((module) => module.movement));

  assert.equal(attacks.size >= 3, true);
  assert.equal(movements.size >= 2, true);
  assert.equal(attacks.has('ground-slam') || attacks.has('charge-sweep'), true);
});

test('prioritizes climax primitives over lower-frequency companions in default plans', () => {
  const climaxInput: BehaviorGenerationInput = {
    ...input,
    segments: [
      { start: 0, end: 20, label: 'drop', energy: 0.94 }
    ],
    primitives: [
      { id: 'b0', kind: 'bass-impact', start: 0, end: 20, segmentIndex: 0, strength: 0.96, confidence: 0.9, features: { energy: 0.94, lowFreqWeight: 0.72, highFreqWeight: 0.22, spectralFlux: 0.5, beatDensity: 0.9, stability: 0.48, intensity: 0.96 } },
      { id: 'c0', kind: 'climax', start: 0, end: 20, segmentIndex: 0, strength: 0.88, confidence: 0.86, features: { energy: 0.94, lowFreqWeight: 0.72, highFreqWeight: 0.22, spectralFlux: 0.5, beatDensity: 0.9, stability: 0.48, intensity: 0.96 } }
    ]
  };

  const plan = createDefaultPrimitivePlan(climaxInput);
  const timeline = compilePrimitivePlan(plan, climaxInput, { source: 'rules', fallbackUsed: false, warnings: [] });

  assert.equal(plan.steps[0].coupling, 'climax');
  assert.equal(timeline.modules[0].attack, 'charge-sweep');
  assert.equal(timeline.modules[0].movement, 'shake');
});

test('splits long high-energy primitive segments into richer micro phases', () => {
  const longDropInput: BehaviorGenerationInput = {
    ...input,
    segments: [
      { start: 0, end: 36, label: 'drop', energy: 0.95 }
    ],
    primitives: [
      { id: 'b0', kind: 'bass-impact', start: 0, end: 36, segmentIndex: 0, strength: 0.92, confidence: 0.9, features: { energy: 0.95, lowFreqWeight: 0.72, highFreqWeight: 0.24, spectralFlux: 0.58, beatDensity: 0.9, stability: 0.46, intensity: 0.96 } },
      { id: 'c0', kind: 'climax', start: 0, end: 36, segmentIndex: 0, strength: 0.94, confidence: 0.9, features: { energy: 0.95, lowFreqWeight: 0.72, highFreqWeight: 0.24, spectralFlux: 0.58, beatDensity: 0.9, stability: 0.46, intensity: 0.96 } }
    ]
  };

  const plan = createDefaultPrimitivePlan(longDropInput);
  const validation = validatePrimitivePlan(plan, longDropInput);
  const timeline = compilePrimitivePlan(plan, longDropInput, { source: 'rules', fallbackUsed: false, warnings: [] });
  const attacks = new Set(timeline.modules.map((module) => module.attack));
  const movements = new Set(timeline.modules.map((module) => module.movement));

  assert.equal(validation.valid, true, validation.warnings.join('\n'));
  assert.equal(plan.steps.length >= 3, true);
  assert.equal(new Set(plan.steps.map((step) => step.phaseRole)).size >= 3, true);
  assert.equal(attacks.size >= 2, true);
  assert.equal(movements.size >= 2, true);
});

test('splits moderate long primitive segments when the audio has a clear primitive signal', () => {
  const moderateInput: BehaviorGenerationInput = {
    ...input,
    segments: [
      { start: 0, end: 22, label: 'verse', energy: 0.42 }
    ],
    primitives: [
      { id: 'b0', kind: 'bass-impact', start: 0, end: 22, segmentIndex: 0, strength: 0.52, confidence: 0.68, features: { energy: 0.42, lowFreqWeight: 0.48, highFreqWeight: 0.1, spectralFlux: 0.3, beatDensity: 0.52, stability: 0.54, intensity: 0.39 } }
    ]
  };

  const plan = createDefaultPrimitivePlan(moderateInput);
  const validation = validatePrimitivePlan(plan, moderateInput);

  assert.equal(validation.valid, true, validation.warnings.join('\n'));
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].end, plan.steps[1].start);
});
