import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBehaviorPromptInput,
  createBehaviorTimeline,
  type BehaviorGenerationInput,
  type BehaviorStrategyOptions,
  type LlmBehaviorProvider
} from '../src/behavior/factory.js';

const input: BehaviorGenerationInput = {
  bpm: 128,
  difficulty: 1,
  beatGrid: Array.from({ length: 64 }, (_, index) => index * 0.46875),
  downbeat: 0,
  segments: [
    { start: 0, end: 12, label: 'intro', energy: 0.18 },
    { start: 12, end: 28, label: 'verse', energy: 0.42 },
    { start: 28, end: 46, label: 'chorus', energy: 0.86 },
    { start: 46, end: 70, label: 'drop', energy: 0.97 }
  ],
  confidence: {
    overall: 0.92,
    segmentation: 0.84,
    tempo: 0.95
  }
};

test('creates a normalized rule-driven timeline with escalating pressure', async () => {
  const timeline = await createBehaviorTimeline(input, { strategy: 'rules' });

  assert.equal(timeline.source, 'rules');
  assert.equal(timeline.modules.length >= 4, true);
  assert.equal(timeline.modules[0].intent, 'warmup');
  assert.equal(timeline.modules[timeline.modules.length - 1].pressureLevel > timeline.modules[0].pressureLevel, true);
});

test('expands long high-energy segments into staged modules', async () => {
  const timeline = await createBehaviorTimeline(input, { strategy: 'rules' });
  const dropModules = timeline.modules.filter((module) => module.segmentLabel === 'drop');

  assert.equal(dropModules.length >= 2, true);
  assert.equal(dropModules[1].start >= dropModules[0].end, true);
});

test('snaps rule module phase boundaries to the detected beat grid', async () => {
  const beatGrid = Array.from({ length: 80 }, (_, index) => Number((0.18 + index * 0.5).toFixed(2)));
  const timeline = await createBehaviorTimeline({
    ...input,
    bpm: 120,
    beatGrid,
    segments: [
      { start: 0, end: 19.3, label: 'chorus', energy: 0.88 }
    ]
  }, { strategy: 'rules' });

  const internalStarts = timeline.modules.slice(1).map((module) => module.start);

  assert.equal(internalStarts.length > 0, true);
  assert.equal(internalStarts.every((start) => beatGrid.some((beat) => Math.abs(beat - start) < 0.00001)), true);
});


test('falls back explicitly to rules when llm generation fails validation', async () => {
  const provider: LlmBehaviorProvider = {
    async generate() {
      return {
        source: 'llm',
        modules: [
          {
            start: 0,
            end: 4,
            segmentLabel: 'verse',
            intent: 'burst',
            movement: 'teleport',
            attack: 'everything'
          }
        ]
      } as never;
    }
  };

  const options: BehaviorStrategyOptions = { strategy: 'llm-preferred', llmProvider: provider };
  const timeline = await createBehaviorTimeline(input, options);

  assert.equal(timeline.source, 'rules');
  assert.equal(timeline.metadata.fallbackUsed, true);
  assert.equal(timeline.metadata.validationWarnings.length > 0, true);
});

test('falls back to rules when llm timeline leaves uncovered gaps', async () => {
  const provider: LlmBehaviorProvider = {
    async generate() {
      return {
        source: 'llm',
        generatedAt: Date.now(),
        metadata: {
          fallbackUsed: false,
          validationWarnings: []
        },
        modules: [
          {
            id: 'intro-0',
            presetId: 'intro-setup-calm-idle-none-steady',
            start: 0,
            end: 8,
            segmentLabel: 'intro',
            intent: 'warmup',
            phaseRole: 'setup',
            movement: 'idle',
            attack: 'none',
            bulletCount: 0,
            bulletSpeed: 0,
            fireWindowBeats: 4,
            warningIntensity: 0.2,
            pressureLevel: 10,
            transitionIn: 'blend',
            transitionOut: 'blend'
          },
          {
            id: 'chorus-12',
            presetId: 'chorus-burst-peak-dash-screen-ring-steady',
            start: 12,
            end: 20,
            segmentLabel: 'chorus',
            intent: 'burst',
            phaseRole: 'burst',
            movement: 'dash',
            attack: 'screen-ring',
            bulletCount: 12,
            bulletSpeed: 220,
            fireWindowBeats: 1,
            warningIntensity: 0.8,
            pressureLevel: 80,
            transitionIn: 'snap',
            transitionOut: 'blend'
          }
        ]
      };
    }
  };

  const timeline = await createBehaviorTimeline(input, { strategy: 'llm-preferred', llmProvider: provider });

  assert.equal(timeline.source, 'rules');
  assert.equal(timeline.metadata.fallbackUsed, true);
  assert.equal(timeline.metadata.validationWarnings.some((warning) => warning.includes('Gap between modules')), true);
});

test('creates a safe idle fallback timeline when no segments are available', async () => {
  const timeline = await createBehaviorTimeline({
    ...input,
    beatGrid: [0, 0.5, 1, 1.5, 2],
    segments: []
  }, { strategy: 'rules' });

  assert.equal(timeline.modules.length, 1);
  assert.equal(timeline.modules[0].attack, 'none');
  assert.equal(timeline.modules[0].movement, 'idle');
  assert.equal(timeline.modules[0].start, 0);
  assert.equal(timeline.modules[0].end >= 2, true);
});

test('normalizes unsorted segments into chronological rule modules', async () => {
  const timeline = await createBehaviorTimeline({
    ...input,
    segments: [
      { start: 20, end: 32, label: 'chorus', energy: 0.82 },
      { start: 0, end: 10, label: 'intro', energy: 0.12 },
      { start: 10, end: 20, label: 'verse', energy: 0.4 }
    ]
  }, { strategy: 'rules' });

  assert.equal(timeline.modules[0].start <= timeline.modules[1].start, true);
  assert.equal(timeline.modules[1].start <= timeline.modules[timeline.modules.length - 1].start, true);
  assert.equal(timeline.modules[0].segmentLabel, 'intro');
});

test('keeps intro sections on safe non-forbidden attacks when pressure stays low', async () => {
  const timeline = await createBehaviorTimeline({
    ...input,
    difficulty: 0.3,
    segments: [
      { start: 0, end: 10, label: 'intro', energy: 0.08 }
    ]
  }, { strategy: 'rules' });

  assert.equal(timeline.modules.length, 1);
  assert.equal(timeline.modules[0].segmentLabel, 'intro');
  assert.equal(timeline.modules[0].attack, 'sparse-ring');
  assert.equal(timeline.modules[0].movement, 'wander');
  assert.equal(timeline.modules[0].pressureLevel >= 24, true);
});

test('promotes at least one actionable module when the whole song would otherwise be passive', async () => {
  const timeline = await createBehaviorTimeline({
    ...input,
    difficulty: 0.3,
    segments: [
      { start: 0, end: 8, label: 'intro', energy: 0.05 },
      { start: 8, end: 16, label: 'outro', energy: 0.08 }
    ]
  }, { strategy: 'rules' });

  assert.equal(timeline.modules.some((module) => module.attack !== 'none' && module.bulletCount > 0), true);
});

test('uses snap transitions when a segment jumps sharply in energy', async () => {
  const timeline = await createBehaviorTimeline({
    ...input,
    segments: [
      { start: 0, end: 12, label: 'verse', energy: 0.2 },
      { start: 12, end: 24, label: 'chorus', energy: 0.9 }
    ]
  }, { strategy: 'rules' });

  const chorusModule = timeline.modules.find((module) => module.segmentLabel === 'chorus');

  assert.equal(chorusModule?.transitionIn, 'snap');
  assert.equal((chorusModule?.warningIntensity ?? 0) > 0.7, true);
});

test('adjusts projectile pace for the same segment across slow and fast tempos', async () => {
  const slowTimeline = await createBehaviorTimeline({
    ...input,
    bpm: 80,
    segments: [
      { start: 0, end: 14, label: 'bridge', energy: 0.58 }
    ]
  }, { strategy: 'rules' });

  const fastTimeline = await createBehaviorTimeline({
    ...input,
    bpm: 156,
    segments: [
      { start: 0, end: 14, label: 'bridge', energy: 0.58 }
    ]
  }, { strategy: 'rules' });

  assert.equal(slowTimeline.modules[0].bulletSpeed < fastTimeline.modules[0].bulletSpeed, true);
  assert.equal(slowTimeline.modules[0].warningIntensity > fastTimeline.modules[0].warningIntensity, true);
});

test('assigns different preset identities to verse modules under different musical contexts', async () => {
  const timeline = await createBehaviorTimeline({
    ...input,
    bpm: 142,
    difficulty: 1.2,
    segments: [
      { start: 0, end: 14, label: 'verse', energy: 0.24 },
      { start: 14, end: 28, label: 'verse', energy: 0.62 },
      { start: 28, end: 44, label: 'verse', energy: 0.48 }
    ]
  }, { strategy: 'rules' });

  const verseModules = timeline.modules.filter((module) => module.segmentLabel === 'verse');
  const presetIds = new Set(verseModules.map((module) => module.presetId));

  assert.equal(presetIds.size >= 2, true);
});

test('expands a long chorus into setup pressure burst and recovery micro phases', async () => {
  const timeline = await createBehaviorTimeline({
    ...input,
    bpm: 132,
    difficulty: 1.4,
    segments: [
      { start: 0, end: 32, label: 'chorus', energy: 0.88 }
    ]
  }, { strategy: 'rules' });

  const chorusModules = timeline.modules.filter((module) => module.segmentLabel === 'chorus');
  const roles = chorusModules.map((module) => module.phaseRole);

  assert.equal(chorusModules.length >= 4, true);
  assert.equal(roles.includes('setup'), true);
  assert.equal(roles.includes('pressure'), true);
  assert.equal(roles.includes('burst'), true);
  assert.equal(roles.includes('recovery') || roles.includes('reposition'), true);
});

test('does not repeat the same high-pressure preset across every micro phase in a long drop', async () => {
  const timeline = await createBehaviorTimeline({
    ...input,
    bpm: 146,
    difficulty: 1.8,
    segments: [
      { start: 0, end: 36, label: 'drop', energy: 0.96 }
    ]
  }, { strategy: 'rules' });

  const dropModules = timeline.modules.filter((module) => module.segmentLabel === 'drop');
  const uniquePresetIds = new Set(dropModules.map((module) => module.presetId));

  assert.equal(dropModules.length >= 4, true);
  assert.equal(uniquePresetIds.size >= 2, true);
});

test('selects advanced attack modes from different music analysis contexts', async () => {
  const slowSparseTimeline = await createBehaviorTimeline({
    ...input,
    bpm: 84,
    difficulty: 1,
    segments: [
      { start: 0, end: 16, label: 'verse', energy: 0.3 }
    ]
  }, { strategy: 'rules' });

  const fastPeakTimeline = await createBehaviorTimeline({
    ...input,
    bpm: 156,
    difficulty: 1.6,
    segments: [
      { start: 0, end: 18, label: 'chorus', energy: 0.9 },
      { start: 18, end: 42, label: 'drop', energy: 0.98 }
    ]
  }, { strategy: 'rules' });

  const slowAttacks = new Set(slowSparseTimeline.modules.map((module) => module.attack));
  const fastAttacks = new Set(fastPeakTimeline.modules.map((module) => module.attack));

  assert.equal(slowAttacks.has('melee-sweep'), true);
  assert.equal(fastAttacks.has('laser-ray'), true);
  assert.equal(fastAttacks.has('explosive-burst') || fastAttacks.has('charge-strike'), true);
});

test('uses FFT weights as the primary rule action signal', async () => {
  const brightTimeline = await createBehaviorTimeline({
    ...input,
    bpm: 132,
    segments: [
      { start: 0, end: 12, label: 'verse', energy: 0.58, lowFreqWeight: 0.1, highFreqWeight: 0.58, stability: 0.7 }
    ]
  }, { strategy: 'rules' });
  const lowHeavyTimeline = await createBehaviorTimeline({
    ...input,
    bpm: 132,
    segments: [
      { start: 0, end: 12, label: 'verse', energy: 0.58, lowFreqWeight: 0.6, highFreqWeight: 0.12, stability: 0.7 }
    ]
  }, { strategy: 'rules' });

  assert.equal(new Set(brightTimeline.modules.map((module) => module.attack)).has('laser-ray'), true);
  assert.equal(new Set(lowHeavyTimeline.modules.map((module) => module.attack)).has('charge-strike'), true);
});

test('uses spectral flux and intensity to drive transition-heavy rule actions', async () => {
  const timeline = await createBehaviorTimeline({
    ...input,
    bpm: 128,
    segments: [
      {
        start: 0,
        end: 12,
        label: 'bridge',
        energy: 0.54,
        lowFreqWeight: 0.26,
        highFreqWeight: 0.28,
        stability: 0.76,
        spectralCentroid: 0.44,
        spectralFlux: 0.82,
        beatDensity: 0.74,
        intensity: 0.78
      }
    ]
  }, { strategy: 'rules' });

  assert.equal(new Set(timeline.modules.map((module) => module.attack)).has('explosive-burst'), true);
  assert.equal(timeline.modules.some((module) => module.transitionIn === 'snap'), true);
  assert.equal(timeline.modules.some((module) => module.pressureLevel >= 70), true);
});

test('rules prefer non-projectile attacks and pursuit spacing movement in active sections', async () => {
  const timeline = await createBehaviorTimeline({
    ...input,
    bpm: 136,
    difficulty: 1.4,
    segments: [
      { start: 0, end: 16, label: 'verse', energy: 0.58, lowFreqWeight: 0.52, highFreqWeight: 0.18, stability: 0.68, intensity: 0.66 },
      { start: 16, end: 34, label: 'bridge', energy: 0.68, lowFreqWeight: 0.28, highFreqWeight: 0.36, stability: 0.58, spectralFlux: 0.7, intensity: 0.74 },
      { start: 34, end: 54, label: 'chorus', energy: 0.86, lowFreqWeight: 0.3, highFreqWeight: 0.54, stability: 0.46, intensity: 0.88 },
      { start: 54, end: 78, label: 'drop', energy: 0.95, lowFreqWeight: 0.62, highFreqWeight: 0.32, stability: 0.4, intensity: 0.96 }
    ]
  }, { strategy: 'rules' });

  const activeModules = timeline.modules.filter((module) => module.attack !== 'none');
  const nonProjectileAttacks = new Set([
    'melee-sweep',
    'laser-ray',
    'explosive-burst',
    'charge-strike',
    'ground-slam',
    'cone-cleave',
    'laser-barrage',
    'charge-sweep'
  ]);
  const projectileOnlyAttacks = new Set(['sparse-ring', 'aimed-burst', 'screen-ring', 'lane-burst']);
  const nonProjectileCount = activeModules.filter((module) => nonProjectileAttacks.has(module.attack)).length;
  const projectileOnlyCount = activeModules.filter((module) => projectileOnlyAttacks.has(module.attack)).length;
  const spacingMovements = new Set(['chase', 'keep-distance', 'outer-orbit']);
  const orbitCount = timeline.modules.filter((module) => module.movement === 'orbit').length;
  const spacingMovementCount = timeline.modules.filter((module) => spacingMovements.has(module.movement)).length;

  assert.equal(nonProjectileCount > projectileOnlyCount, true);
  assert.equal(spacingMovementCount >= 3, true);
  assert.equal(orbitCount <= 1, true);
});

test('combines weak adjacent FFT segments into flexible behavior sections', async () => {
  const timeline = await createBehaviorTimeline({
    ...input,
    bpm: 124,
    segments: [
      { start: 0, end: 5, label: 'verse', energy: 0.42, lowFreqWeight: 0.24, highFreqWeight: 0.28, stability: 0.78 },
      { start: 5, end: 10, label: 'bridge', energy: 0.46, lowFreqWeight: 0.25, highFreqWeight: 0.3, stability: 0.76 },
      { start: 10, end: 20, label: 'chorus', energy: 0.84, lowFreqWeight: 0.12, highFreqWeight: 0.62, stability: 0.52 }
    ]
  }, { strategy: 'rules' });

  assert.equal(timeline.modules.some((module) => module.start < 5 && module.end > 5), true);
  assert.equal(timeline.modules.some((module) => module.start < 10 && module.end > 10), false);
});

test('exposes music primitives in the behavior prompt contract', () => {
  const prompt = buildBehaviorPromptInput({
    ...input,
    primitives: [
      {
        id: 'p0-bright-beam',
        kind: 'bright-beam',
        start: 28,
        end: 46,
        segmentIndex: 2,
        strength: 0.9,
        confidence: 0.86,
        features: {
          energy: 0.86,
          lowFreqWeight: 0.12,
          highFreqWeight: 0.68,
          spectralFlux: 0.66,
          beatDensity: 0.84,
          stability: 0.52,
          intensity: 0.88
        }
      }
    ]
  });

  assert.equal(prompt.primitiveCatalog.length, 1);
  assert.equal(prompt.primitiveCatalog[0].kind, 'bright-beam');
  assert.equal(prompt.designRules.some((rule) => rule.includes('primitive')), true);
  assert.deepEqual(prompt.outputContract.requiredTopLevelFields, ['source', 'steps', 'generatedAt', 'metadata']);
  assert.equal(prompt.outputContract.requiredStepFields?.includes('primitiveIds'), true);
});

test('compiles llm primitive plans instead of falling back to rules', async () => {
  const provider: LlmBehaviorProvider = {
    async generate() {
      return {
        source: 'primitive-plan',
        generatedAt: 456,
        steps: [
          {
            id: 'llm-beam-step',
            start: 0,
            end: 18,
            primitiveIds: ['p0-bright-beam'],
            intent: 'lockdown',
            phaseRole: 'burst',
            coupling: 'single',
            intensity: 0.9
          }
        ],
        metadata: {
          modelName: 'primitive-agent-test'
        }
      } as never;
    }
  };

  const timeline = await createBehaviorTimeline({
    ...input,
    segments: [
      { start: 0, end: 18, label: 'chorus', energy: 0.88, lowFreqWeight: 0.12, highFreqWeight: 0.68, spectralCentroid: 0.78, spectralFlux: 0.64, beatDensity: 0.86, stability: 0.5, intensity: 0.9 }
    ],
    primitives: [
      {
        id: 'p0-bright-beam',
        kind: 'bright-beam',
        start: 0,
        end: 18,
        segmentIndex: 0,
        strength: 0.9,
        confidence: 0.86,
        features: {
          energy: 0.88,
          lowFreqWeight: 0.12,
          highFreqWeight: 0.68,
          spectralCentroid: 0.78,
          spectralFlux: 0.64,
          beatDensity: 0.86,
          stability: 0.5,
          intensity: 0.9
        }
      }
    ]
  }, { strategy: 'llm-preferred', llmProvider: provider });

  assert.equal(timeline.source, 'llm');
  assert.equal(timeline.metadata.fallbackUsed, false);
  assert.equal(timeline.metadata.modelName, 'primitive-agent-test');
  assert.equal(timeline.modules[0].attack, 'laser-barrage');
  assert.equal(timeline.modules[0].presetId.includes('primitive'), true);
});

test('rule primitive fallback still covers quiet segments without primitive signals', async () => {
  const timeline = await createBehaviorTimeline({
    ...input,
    segments: [
      { start: 0, end: 8, label: 'intro', energy: 0.12 },
      { start: 8, end: 20, label: 'chorus', energy: 0.88, lowFreqWeight: 0.16, highFreqWeight: 0.68, intensity: 0.9 }
    ],
    primitives: [
      {
        id: 'p1-bright-beam',
        kind: 'bright-beam',
        start: 8,
        end: 20,
        segmentIndex: 1,
        strength: 0.9,
        confidence: 0.86,
        features: {
          energy: 0.88,
          lowFreqWeight: 0.16,
          highFreqWeight: 0.68,
          spectralFlux: 0.64,
          beatDensity: 0.86,
          stability: 0.52,
          intensity: 0.9
        }
      }
    ]
  }, { strategy: 'rules' });

  assert.equal(timeline.source, 'rules');
  assert.equal(timeline.modules[0].start, 0);
  assert.equal(timeline.modules[timeline.modules.length - 1].end, 20);
  assert.equal(timeline.modules.some((module) => module.segmentLabel === 'intro'), true);
  assert.equal(timeline.modules.some((module) => module.attack === 'laser-barrage' || module.attack === 'laser-ray'), true);
});

test('varies attack and movement groups inside an FFT-heavy section', async () => {
  const timeline = await createBehaviorTimeline({
    ...input,
    bpm: 146,
    difficulty: 1.3,
    segments: [
      { start: 0, end: 28, label: 'drop', energy: 0.9, lowFreqWeight: 0.18, highFreqWeight: 0.7, stability: 0.46 }
    ]
  }, { strategy: 'rules' });

  const nonProjectileAttacks = new Set([
    'melee-sweep',
    'laser-ray',
    'explosive-burst',
    'charge-strike',
    'ground-slam',
    'cone-cleave',
    'laser-barrage',
    'charge-sweep'
  ]);
  assert.equal(timeline.modules.filter((module) => module.attack !== 'none').every((module) => nonProjectileAttacks.has(module.attack)), true);
  assert.equal(new Set(timeline.modules.map((module) => module.attack)).size >= 2, true);
  assert.equal(new Set(timeline.modules.map((module) => module.movement)).size >= 2, true);
});

test('adds coupled attacks to high-pressure chorus and drop sections', async () => {
  const timeline = await createBehaviorTimeline({
    ...input,
    bpm: 150,
    difficulty: 1.8,
    segments: [
      { start: 0, end: 24, label: 'chorus', energy: 0.9, highFreqWeight: 0.62, lowFreqWeight: 0.22, intensity: 0.92 },
      { start: 24, end: 52, label: 'drop', energy: 0.98, highFreqWeight: 0.44, lowFreqWeight: 0.58, intensity: 0.98 }
    ]
  }, { strategy: 'rules' });

  const coupledAttacks = new Set(['laser-barrage', 'charge-sweep']);

  assert.equal(timeline.modules.some((module) => coupledAttacks.has(module.attack)), true);
  assert.equal(timeline.modules
    .filter((module) => coupledAttacks.has(module.attack))
    .every((module) => module.pressureLevel >= 78), true);
});

test('surfaces new threat shapes in ordinary high-energy chorus and drop sections', async () => {
  const timeline = await createBehaviorTimeline({
    ...input,
    bpm: 128,
    difficulty: 1.2,
    segments: [
      {
        start: 0,
        end: 16,
        label: 'chorus',
        energy: 0.88,
        lowFreqWeight: 0.45,
        highFreqWeight: 0.48,
        stability: 0.65,
        spectralFlux: 0.4,
        beatDensity: 0.75,
        intensity: 0.84
      },
      {
        start: 16,
        end: 40,
        label: 'drop',
        energy: 0.86,
        lowFreqWeight: 0.54,
        highFreqWeight: 0.42,
        stability: 0.55,
        spectralFlux: 0.5,
        beatDensity: 0.8,
        intensity: 0.84
      }
    ]
  }, { strategy: 'rules' });

  const attacks = new Set<string>(timeline.modules.map((module) => module.attack));
  const visibleNewAttacks = new Set(['ground-slam', 'cone-cleave', 'laser-barrage', 'charge-sweep']);

  assert.equal([...visibleNewAttacks].some((attack) => attacks.has(attack)), true);
  assert.equal(attacks.has('ground-slam') || attacks.has('cone-cleave'), true);
  assert.equal(attacks.has('laser-barrage') || attacks.has('charge-sweep'), true);
});

test('pairs melee sweep pressure with pursuit movement in active sections', async () => {
  const timeline = await createBehaviorTimeline({
    ...input,
    bpm: 132,
    difficulty: 1.1,
    segments: [
      { start: 0, end: 16, label: 'bridge', energy: 0.66, lowFreqWeight: 0.34, highFreqWeight: 0.32, stability: 0.62, intensity: 0.7 }
    ]
  }, { strategy: 'rules' });

  const meleeModules = timeline.modules.filter((module) => module.attack === 'melee-sweep');

  assert.equal(meleeModules.length > 0, true);
  assert.equal(meleeModules.every((module) => ['chase', 'dash', 'shake'].includes(module.movement)), true);
});

test('splits valid llm modules on FFT segment boundaries and adapts actions to each segment', async () => {
  const provider: LlmBehaviorProvider = {
    async generate() {
      return {
        source: 'llm',
        generatedAt: Date.now(),
        metadata: {
          fallbackUsed: false,
          validationWarnings: [],
          modelName: 'test-wide-module-model'
        },
        modules: [
          {
            id: 'llm-wide-0',
            presetId: 'llm-wide',
            start: 0,
            end: 24,
            segmentLabel: 'verse',
            intent: 'pressure',
            phaseRole: 'pressure',
            movement: 'wander',
            attack: 'sparse-ring',
            bulletCount: 6,
            bulletSpeed: 150,
            fireWindowBeats: 4,
            warningIntensity: 0.4,
            pressureLevel: 40,
            transitionIn: 'blend',
            transitionOut: 'blend'
          }
        ]
      };
    }
  };

  const timeline = await createBehaviorTimeline({
    ...input,
    segments: [
      { start: 0, end: 8, label: 'verse', energy: 0.46, lowFreqWeight: 0.48, highFreqWeight: 0.1, stability: 0.7 },
      { start: 8, end: 16, label: 'chorus', energy: 0.7, lowFreqWeight: 0.1, highFreqWeight: 0.62, stability: 0.68 },
      { start: 16, end: 24, label: 'drop', energy: 0.88, lowFreqWeight: 0.64, highFreqWeight: 0.18, stability: 0.42 }
    ]
  }, { strategy: 'llm-preferred', llmProvider: provider });

  assert.equal(timeline.source, 'llm');
  assert.deepEqual(timeline.modules.map((module) => module.start), [0, 8, 16]);
  assert.deepEqual(timeline.modules.map((module) => module.end), [8, 16, 24]);
  assert.deepEqual(timeline.modules.map((module) => module.segmentLabel), ['verse', 'chorus', 'drop']);
  assert.equal(timeline.modules[0].attack, 'charge-strike');
  assert.equal(['laser-ray', 'melee-sweep', 'charge-strike'].includes(timeline.modules[1].attack), true);
  assert.equal(['explosive-burst', 'charge-strike', 'screen-ring'].includes(timeline.modules[2].attack), true);
});

test('accepts llm-generated advanced action modules without falling back to rules', async () => {
  const provider: LlmBehaviorProvider = {
    async generate() {
      return {
        source: 'llm',
        generatedAt: Date.now(),
        metadata: {
          fallbackUsed: false,
          validationWarnings: [],
          modelName: 'test-action-model'
        },
        modules: [
          {
            id: 'llm-laser-0',
            presetId: 'llm-laser-fast',
            start: 0,
            end: 6,
            segmentLabel: 'chorus',
            intent: 'burst',
            phaseRole: 'pressure',
            movement: 'orbit',
            attack: 'laser-ray',
            bulletCount: 3,
            bulletSpeed: 260,
            fireWindowBeats: 1,
            warningIntensity: 0.72,
            pressureLevel: 72,
            transitionIn: 'snap',
            transitionOut: 'blend'
          },
          {
            id: 'llm-charge-6',
            presetId: 'llm-charge-drop',
            start: 6,
            end: 12,
            segmentLabel: 'drop',
            intent: 'lockdown',
            phaseRole: 'burst',
            movement: 'dash',
            attack: 'charge-strike',
            bulletCount: 1,
            bulletSpeed: 220,
            fireWindowBeats: 2,
            warningIntensity: 0.85,
            pressureLevel: 86,
            transitionIn: 'snap',
            transitionOut: 'blend'
          }
        ]
      };
    }
  };

  const timeline = await createBehaviorTimeline({
    ...input,
    segments: [
      { start: 0, end: 6, label: 'chorus', energy: 0.86 },
      { start: 6, end: 12, label: 'drop', energy: 0.94 }
    ]
  }, { strategy: 'llm-preferred', llmProvider: provider });

  assert.equal(timeline.source, 'llm');
  assert.equal(timeline.metadata.fallbackUsed, false);
  assert.equal(timeline.modules[0].attack, 'laser-ray');
  assert.equal(timeline.modules[1].attack, 'charge-strike');
});
