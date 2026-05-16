import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
