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
