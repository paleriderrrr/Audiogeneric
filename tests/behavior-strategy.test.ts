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
  beatGrid: Array.from({ length: 64 }, (_, index) => index * 0.46875),
  downbeat: 0,
  styleProfile: {
    primaryStyle: 'rock',
    confidence: 0.82,
    energyMean: 0.7,
    lowFreqWeight: 0.68,
    highFreqWeight: 0.35,
    dynamicRange: 0.5,
    beatDensity: 0.72,
    segmentContrast: 0.62,
    descriptors: ['wide-impact-hits']
  },
  segments: [
    { start: 0, end: 12, label: 'intro', energy: 0.18 },
    { start: 12, end: 28, label: 'verse', energy: 0.42 },
    { start: 28, end: 46, label: 'chorus', energy: 0.86 },
    { start: 46, end: 70, label: 'drop', energy: 0.97 }
  ],
  segmentFeatures: [
    { start: 0, end: 12, label: 'intro', energy: 0.18, beatDensity: 0.3, lowFreqWeight: 0.3, highFreqWeight: 0.2, stability: 0.8, intensityRole: 'setup', recommendedAttack: 'none' },
    { start: 12, end: 28, label: 'verse', energy: 0.42, beatDensity: 0.6, lowFreqWeight: 0.5, highFreqWeight: 0.3, stability: 0.7, intensityRole: 'groove', recommendedAttack: 'sparse-ring' },
    { start: 28, end: 46, label: 'chorus', energy: 0.86, beatDensity: 0.8, lowFreqWeight: 0.7, highFreqWeight: 0.4, stability: 0.5, intensityRole: 'peak', recommendedAttack: 'screen-ring' },
    { start: 46, end: 70, label: 'drop', energy: 0.97, beatDensity: 0.9, lowFreqWeight: 0.8, highFreqWeight: 0.5, stability: 0.45, intensityRole: 'climax', recommendedAttack: 'screen-ring' }
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

test('rejects llm timelines with invalid numeric ranges and transitions', async () => {
  const provider: LlmBehaviorProvider = {
    async generate() {
      return {
        source: 'llm',
        modules: [
          {
            id: 'unsafe',
            start: 0,
            end: 8,
            segmentLabel: 'verse',
            intent: 'pressure',
            movement: 'wander',
            attack: 'sparse-ring',
            bulletCount: 4,
            bulletSpeed: -1,
            fireWindowBeats: 0,
            warningIntensity: 2,
            pressureLevel: 120,
            transitionIn: 'fade',
            transitionOut: 'fade'
          }
        ],
        generatedAt: 0,
        metadata: {
          fallbackUsed: false,
          validationWarnings: []
        }
      } as never;
    }
  };

  const timeline = await createBehaviorTimeline(input, { strategy: 'llm-preferred', llmProvider: provider });

  assert.equal(timeline.source, 'rules');
  assert.equal(timeline.metadata.fallbackUsed, true);
  assert.equal(timeline.metadata.validationWarnings.some((warning) => warning.includes('bullet speed')), true);
});

test('rejects llm timelines with overlaps and gaps', async () => {
  const provider: LlmBehaviorProvider = {
    async generate() {
      return {
        source: 'llm',
        modules: [
          {
            id: 'first',
            start: 0,
            end: 4,
            segmentLabel: 'verse',
            intent: 'pressure',
            movement: 'wander',
            attack: 'sparse-ring',
            bulletCount: 4,
            bulletSpeed: 140,
            fireWindowBeats: 2,
            warningIntensity: 0.4,
            pressureLevel: 40,
            transitionIn: 'blend',
            transitionOut: 'blend'
          },
          {
            id: 'second',
            start: 3,
            end: 8,
            segmentLabel: 'chorus',
            intent: 'burst',
            movement: 'dash',
            attack: 'aimed-burst',
            bulletCount: 8,
            bulletSpeed: 180,
            fireWindowBeats: 1,
            warningIntensity: 0.7,
            pressureLevel: 70,
            transitionIn: 'snap',
            transitionOut: 'blend'
          }
        ],
        generatedAt: 0,
        metadata: {
          fallbackUsed: false,
          validationWarnings: []
        }
      } as never;
    }
  };

  const timeline = await createBehaviorTimeline(input, { strategy: 'llm-preferred', llmProvider: provider });

  assert.equal(timeline.source, 'rules');
  assert.equal(timeline.metadata.validationWarnings.some((warning) => warning.includes('overlap')), true);
});

test('builds a model-ready prompt payload with style and segment strategy features', () => {
  const prompt = buildBehaviorPromptInput(input);

  assert.equal(prompt.trackSummary.primaryStyle, 'rock');
  assert.equal(prompt.trackSummary.bpm, 128);
  assert.equal(prompt.segments[2].recommendedAttack, 'screen-ring');
  assert.equal(prompt.availableAttacks.includes('lane-burst'), true);
  assert.equal(prompt.designRules.some((rule) => rule.includes('rock')), true);
  assert.equal(prompt.outputContract.requiredTopLevelFields.includes('modules'), true);
});

test('parses a JSON string returned by an llm provider into a validated timeline', async () => {
  const provider: LlmBehaviorProvider = {
    async generate(_, prompt) {
      assert.equal(prompt.trackSummary.primaryStyle, 'rock');
      return JSON.stringify({
        source: 'llm',
        modules: input.segments.map((segment, index) => ({
          id: `llm-${index}`,
          start: segment.start,
          end: segment.end,
          segmentLabel: segment.label,
          intent: index < 1 ? 'warmup' : 'burst',
          movement: index < 1 ? 'idle' : 'dash',
          attack: index < 1 ? 'none' : 'screen-ring',
          bulletCount: index < 1 ? 0 : 12,
          bulletSpeed: index < 1 ? 90 : 190,
          fireWindowBeats: index < 1 ? 4 : 1,
          warningIntensity: index < 1 ? 0.2 : 0.8,
          pressureLevel: index < 1 ? 10 : 75,
          transitionIn: index < 1 ? 'blend' : 'snap',
          transitionOut: 'blend'
        })),
        generatedAt: 123,
        metadata: {
          fallbackUsed: false,
          validationWarnings: [],
          styleApplied: 'rock',
          strategyNotes: ['rock uses wide pressure and large ring attacks']
        }
      });
    }
  };

  const timeline = await createBehaviorTimeline(input, { strategy: 'llm-preferred', llmProvider: provider });

  assert.equal(timeline.source, 'llm');
  assert.equal(timeline.metadata.styleApplied, 'rock');
  assert.equal(timeline.modules.some((module) => module.attack === 'screen-ring'), true);
});

test('parses fenced JSON returned by an llm provider', async () => {
  const provider: LlmBehaviorProvider = {
    async generate() {
      return `\`\`\`json
{
  "source": "llm",
  "modules": [
    {
      "id": "fenced-0",
      "start": 0,
      "end": 12,
      "segmentLabel": "intro",
      "intent": "warmup",
      "movement": "idle",
      "attack": "none",
      "bulletCount": 0,
      "bulletSpeed": 90,
      "fireWindowBeats": 4,
      "warningIntensity": 0.2,
      "pressureLevel": 10,
      "transitionIn": "blend",
      "transitionOut": "blend"
    },
    {
      "id": "fenced-1",
      "start": 12,
      "end": 28,
      "segmentLabel": "verse",
      "intent": "pressure",
      "movement": "wander",
      "attack": "sparse-ring",
      "bulletCount": 6,
      "bulletSpeed": 130,
      "fireWindowBeats": 2,
      "warningIntensity": 0.35,
      "pressureLevel": 35,
      "transitionIn": "blend",
      "transitionOut": "blend"
    },
    {
      "id": "fenced-2",
      "start": 28,
      "end": 46,
      "segmentLabel": "chorus",
      "intent": "burst",
      "movement": "dash",
      "attack": "screen-ring",
      "bulletCount": 12,
      "bulletSpeed": 190,
      "fireWindowBeats": 1,
      "warningIntensity": 0.82,
      "pressureLevel": 78,
      "transitionIn": "snap",
      "transitionOut": "blend"
    },
    {
      "id": "fenced-3",
      "start": 46,
      "end": 70,
      "segmentLabel": "drop",
      "intent": "lockdown",
      "movement": "shake",
      "attack": "screen-ring",
      "bulletCount": 16,
      "bulletSpeed": 210,
      "fireWindowBeats": 1,
      "warningIntensity": 0.9,
      "pressureLevel": 90,
      "transitionIn": "snap",
      "transitionOut": "blend"
    }
  ],
  "generatedAt": 456,
  "metadata": {
    "fallbackUsed": false,
    "validationWarnings": [],
    "styleApplied": "rock",
    "strategyNotes": ["fenced json parsed"]
  }
}
\`\`\``;
    }
  };

  const timeline = await createBehaviorTimeline(input, { strategy: 'llm-preferred', llmProvider: provider });

  assert.equal(timeline.source, 'llm');
  assert.equal(timeline.metadata.strategyNotes?.[0], 'fenced json parsed');
});

test('falls back with explicit warnings for malformed llm objects', async () => {
  const provider: LlmBehaviorProvider = {
    async generate() {
      return {
        source: 'llm',
        metadata: {
          fallbackUsed: false,
          validationWarnings: []
        }
      };
    }
  };

  const timeline = await createBehaviorTimeline(input, { strategy: 'llm-preferred', llmProvider: provider });

  assert.equal(timeline.source, 'rules');
  assert.equal(timeline.metadata.validationWarnings.includes('Invalid timeline: modules must be an array'), true);
});

test('falls back when llm output applies a different style than the analyzed track', async () => {
  const provider: LlmBehaviorProvider = {
    async generate() {
      return {
        source: 'llm',
        modules: input.segments.map((segment, index) => ({
          id: `style-mismatch-${index}`,
          start: segment.start,
          end: segment.end,
          segmentLabel: segment.label,
          intent: index < 1 ? 'warmup' : 'pressure',
          movement: index < 1 ? 'idle' : 'wander',
          attack: index < 1 ? 'none' : 'sparse-ring',
          bulletCount: index < 1 ? 0 : 6,
          bulletSpeed: index < 1 ? 90 : 130,
          fireWindowBeats: index < 1 ? 4 : 2,
          warningIntensity: index < 1 ? 0.2 : 0.4,
          pressureLevel: index < 1 ? 10 : 35,
          transitionIn: 'blend',
          transitionOut: 'blend'
        })),
        generatedAt: 789,
        metadata: {
          fallbackUsed: false,
          validationWarnings: [],
          styleApplied: 'ambient',
          strategyNotes: ['ignored rock strategy']
        }
      };
    }
  };

  const timeline = await createBehaviorTimeline(input, { strategy: 'llm-preferred', llmProvider: provider });

  assert.equal(timeline.source, 'rules');
  assert.equal(timeline.metadata.validationWarnings.includes('Style mismatch: expected rock, got ambient'), true);
});

test('rule fallback metadata records the applied analyzed style', async () => {
  const timeline = await createBehaviorTimeline(input, { strategy: 'rules' });

  assert.equal(timeline.metadata.styleApplied, 'rock');
  assert.equal(timeline.metadata.strategyNotes?.some((note) => note.includes('rule fallback')), true);
});

test('uses style-aware rules when llm generation is unavailable', async () => {
  const electronicInput: BehaviorGenerationInput = {
    ...input,
    styleProfile: {
      primaryStyle: 'electronic',
      confidence: 0.88,
      energyMean: 0.72,
      lowFreqWeight: 0.35,
      highFreqWeight: 0.82,
      dynamicRange: 0.18,
      beatDensity: 0.92,
      segmentContrast: 0.3,
      descriptors: ['short-fast-pulses']
    }
  };

  const rockTimeline = await createBehaviorTimeline(input, { strategy: 'rules' });
  const electronicTimeline = await createBehaviorTimeline(electronicInput, { strategy: 'rules' });

  const rockPeak = rockTimeline.modules.find((module) => module.segmentLabel === 'chorus');
  const electronicPeak = electronicTimeline.modules.find((module) => module.segmentLabel === 'chorus');

  assert.equal((rockPeak?.warningIntensity ?? 0) > (electronicPeak?.warningIntensity ?? 0), true);
  assert.equal((electronicPeak?.fireWindowBeats ?? 99) <= (rockPeak?.fireWindowBeats ?? 99), true);
  assert.equal(['lane-burst', 'aimed-burst'].includes(electronicPeak?.attack ?? 'none'), true);
});
