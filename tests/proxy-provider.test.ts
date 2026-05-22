import test from 'node:test';
import assert from 'node:assert/strict';
import { createProxyBehaviorProvider } from '../src/behavior/proxy-provider.js';
import type { BehaviorGenerationInput, BehaviorTimeline } from '../src/behavior/types.js';

const input: BehaviorGenerationInput = {
  bpm: 120,
  difficulty: 1,
  beatGrid: [0, 0.5, 1],
  downbeat: 0,
  segments: [
    { start: 0, end: 1, label: 'intro', energy: 0.2 }
  ],
  confidence: {
    overall: 0.9,
    segmentation: 0.8,
    tempo: 0.95
  }
};

const timeline: BehaviorTimeline = {
  source: 'llm',
  generatedAt: 1,
  metadata: {
    modelName: 'mimo-v2-flash',
    fallbackUsed: false,
    validationWarnings: []
  },
  modules: []
};

test('proxy behavior provider calls same-origin API without exposing an authorization header', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const provider = createProxyBehaviorProvider({
    endpoint: '/api/behavior-timeline',
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify(timeline), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  const result = await provider.generate(input);

  assert.equal(capturedUrl, '/api/behavior-timeline');
  assert.equal(capturedInit?.method, 'POST');
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers.Authorization, undefined);
  assert.equal(headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), input);
  assert.equal(result.metadata.modelName, 'mimo-v2-flash');
});

test('proxy behavior provider reports server errors', async () => {
  const provider = createProxyBehaviorProvider({
    fetchImpl: async () => new Response('missing MIMO_API_KEY', { status: 503, statusText: 'Service Unavailable' })
  });

  await assert.rejects(
    () => provider.generate(input),
    /大模型代理请求失败：503 Service Unavailable - missing MIMO_API_KEY/
  );
});
