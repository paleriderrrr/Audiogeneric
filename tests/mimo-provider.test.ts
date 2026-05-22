import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMimoBehaviorProvider,
  createMimoBehaviorProviderFromEnv
} from '../src/behavior/mimo-provider.js';
import { validateBehaviorTimeline } from '../src/behavior/validate.js';
import type { BehaviorGenerationInput, BehaviorTimeline } from '../src/behavior/types.js';

const input: BehaviorGenerationInput = {
  bpm: 128,
  difficulty: 1,
  beatGrid: [0, 0.5, 1, 1.5, 2],
  downbeat: 0,
  segments: [
    {
      start: 0,
      end: 2,
      label: 'intro',
      energy: 0.2,
      lowFreqWeight: 0.26,
      highFreqWeight: 0.08,
      stability: 0.82,
      spectralCentroid: 0.18,
      spectralFlux: 0.22,
      beatDensity: 0.44,
      intensity: 0.3
    }
  ],
  confidence: {
    overall: 0.9,
    segmentation: 0.8,
    tempo: 0.95
  }
};

const llmTimeline: BehaviorTimeline = {
  source: 'llm',
  generatedAt: 123,
    metadata: {
    modelName: 'mimo-v2.5',
    fallbackUsed: false,
    validationWarnings: []
  },
  modules: [
    {
      id: 'mimo-intro-0',
      presetId: 'mimo-intro-warmup',
      start: 0,
      end: 2,
      segmentLabel: 'intro',
      intent: 'warmup',
      phaseRole: 'setup',
      movement: 'idle',
      attack: 'none',
      bulletCount: 0,
      bulletSpeed: 0,
      fireWindowBeats: 4,
      warningIntensity: 0.1,
      pressureLevel: 8,
      transitionIn: 'blend',
      transitionOut: 'blend'
    }
  ]
};

test('calls Xiaomi MiMo through an OpenAI-compatible chat completions request', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const provider = createMimoBehaviorProvider({
    apiKey: 'test-key',
    now: () => 123,
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return jsonResponse({
        choices: [
          { message: { content: JSON.stringify(llmTimeline) } }
        ]
      });
    }
  });

  const timeline = await provider.generate(input);

  assert.equal(capturedUrl, 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions');
  assert.equal(capturedInit?.method, 'POST');
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer test-key');
  assert.equal(headers['Content-Type'], 'application/json');
  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.model, 'mimo-v2.5');
  assert.equal(body.messages.length, 2);
  const prompt = JSON.parse(body.messages[1].content);
  assert.equal(prompt.music.segments[0].lowFreqWeight, 0.26);
  assert.equal(prompt.music.segments[0].highFreqWeight, 0.08);
  assert.equal(prompt.music.segments[0].stability, 0.82);
  assert.equal(prompt.music.segments[0].spectralCentroid, 0.18);
  assert.equal(prompt.music.segments[0].spectralFlux, 0.22);
  assert.equal(prompt.music.segments[0].beatDensity, 0.44);
  assert.equal(prompt.music.segments[0].intensity, 0.3);
  assert.equal(prompt.music.segments[0].spectralTilt, 'low-heavy');
  assert.equal(Array.isArray(prompt.music.segments[0].recommendedAttacks), true);
  assert.equal(prompt.decisionGuide.some((line: string) => line.includes('highFreqWeight')), true);
  assert.equal(timeline.source, 'llm');
  assert.equal(timeline.metadata.modelName, 'mimo-v2.5');
  assert.equal(timeline.generatedAt, 123);
});

test('adds FFT-informed action recommendations to the MiMo prompt', async () => {
  let capturedBody: unknown;
  const provider = createMimoBehaviorProvider({
    apiKey: 'test-key',
    fetchImpl: async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse({
        choices: [
          { message: { content: JSON.stringify(llmTimeline) } }
        ]
      });
    }
  });

  await provider.generate({
    ...input,
    bpm: 150,
    segments: [
      {
        start: 0,
        end: 12,
        label: 'chorus',
        energy: 0.82,
        lowFreqWeight: 0.12,
        highFreqWeight: 0.62,
        stability: 0.48,
        spectralCentroid: 0.72,
        spectralFlux: 0.66,
        beatDensity: 0.84,
        intensity: 0.88
      }
    ]
  });

  const body = capturedBody as { messages: Array<{ content: string }> };
  const systemPrompt = body.messages[0].content;
  const prompt = JSON.parse(body.messages[1].content);
  const segment = prompt.music.segments[0];

  assert.equal(segment.spectralTilt, 'bright');
  assert.equal(segment.recommendedAttacks.includes('laser-ray'), true);
  assert.equal(segment.recommendedAttacks.includes('lane-burst'), true);
  assert.deepEqual(segment.movementOptions, ['idle', 'wander', 'dash', 'orbit', 'shake', 'chase', 'keep-distance', 'outer-orbit']);
  assert.equal('recommendedMovement' in segment, false);
  assert.equal(segment.spectralFlux, 0.66);
  assert.equal(segment.intensity, 0.88);
  assert.equal(systemPrompt.includes('固定偏好'), true);
  assert.equal(systemPrompt.includes('移动不要只使用 orbit'), false);
  assert.equal(prompt.decisionGuide.some((line: string) => line.includes('spectralFlux')), true);
  assert.equal(prompt.decisionGuide.some((line: string) => line.includes('not pre-ranked')), true);
});

test('accepts fenced JSON returned by MiMo', async () => {
  const provider = createMimoBehaviorProvider({
    apiKey: 'test-key',
    model: 'mimo-v2-pro',
    now: () => 456,
    fetchImpl: async () => jsonResponse({
      choices: [
        { message: { content: `\`\`\`json\n${JSON.stringify(llmTimeline)}\n\`\`\`` } }
      ]
    })
  });

  const timeline = await provider.generate(input);

  assert.equal(timeline.metadata.modelName, 'mimo-v2-pro');
  assert.equal(timeline.generatedAt, 456);
});

test('reports MiMo API errors with response details', async () => {
  const provider = createMimoBehaviorProvider({
    apiKey: 'test-key',
    fetchImpl: async () => new Response('quota exceeded', { status: 429, statusText: 'Too Many Requests' })
  });

  await assert.rejects(
    () => provider.generate(input),
    /MiMo API 请求失败：429 Too Many Requests - quota exceeded/
  );
});

test('creates MiMo provider from server-only environment variables', async () => {
  let capturedUrl = '';
  const provider = createMimoBehaviorProviderFromEnv({
    MIMO_API_KEY: 'server-key',
    MIMO_MODEL: 'mimo-v2-pro',
    MIMO_BASE_URL: 'https://example.test/v1',
    VITE_MIMO_API_KEY: 'front-end-key'
  }, async (url) => {
    capturedUrl = String(url);
    return jsonResponse({
      choices: [
        { message: { content: JSON.stringify(llmTimeline) } }
      ]
    });
  });

  assert.notEqual(provider, null);
  if (!provider) throw new Error('expected MiMo provider');
  const timeline = await provider.generate(input);

  assert.equal(capturedUrl, 'https://example.test/v1/chat/completions');
  assert.equal(timeline.metadata.modelName, 'mimo-v2-pro');
});

test('creates MiMo provider with configurable live timeout', async () => {
  let aborted = false;
  const provider = createMimoBehaviorProviderFromEnv({
    MIMO_API_KEY: 'server-key',
    MIMO_TIMEOUT_MS: '1'
  }, async (_url, init) => {
    await new Promise((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
    throw new Error('unreachable');
  });

  assert.notEqual(provider, null);
  if (!provider) throw new Error('expected MiMo provider');

  await assert.rejects(
    () => provider.generate(input),
    /MiMo API 请求超时：超过 0 秒未返回/
  );
  assert.equal(aborted, true);
});

test('uses a longer default MiMo timeout for full-song prompts', async () => {
  let signal: AbortSignal | undefined;
  const provider = createMimoBehaviorProvider({
    apiKey: 'test-key',
    fetchImpl: async (_url, init) => {
      signal = init?.signal as AbortSignal | undefined;
      return jsonResponse({
        choices: [
          { message: { content: JSON.stringify(llmTimeline) } }
        ]
      });
    }
  });

  await provider.generate(input);

  assert.equal(signal?.aborted, false);
});

test('live MiMo API returns a valid behavior timeline when explicitly enabled', {
  skip: process.env.MIMO_LIVE_TEST === '1' && process.env.MIMO_API_KEY
    ? false
    : 'set MIMO_LIVE_TEST=1 and MIMO_API_KEY to run live MiMo verification'
}, async () => {
  const provider = createMimoBehaviorProviderFromEnv(process.env as Record<string, string | undefined>);
  if (!provider) throw new Error('expected live MiMo provider');

  const timeline = await provider.generate(input);
  const validation = validateBehaviorTimeline(timeline);

  assert.equal(timeline.source, 'llm');
  assert.equal(validation.valid, true, validation.warnings.join('\n'));
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
