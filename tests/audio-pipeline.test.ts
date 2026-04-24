import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTempoCandidates,
  calibrateWarmupTaps,
  selectWarmupWindow,
  summarizeSegmentEnergies,
  type EnergyFrame
} from '../src/audio/pipeline.js';

test('builds ranked tempo candidates from beat intervals', () => {
  const candidates = buildTempoCandidates([0.5, 1.0, 1.5, 2.0, 2.5]);

  assert.equal(candidates.length > 0, true);
  assert.equal(candidates[0].bpm, 120);
  assert.equal(candidates[0].score >= candidates[candidates.length - 1].score, true);
});

test('selects a warmup window from the steadiest energetic section', () => {
  const frames: EnergyFrame[] = [];
  for (let index = 0; index < 200; index += 1) {
    const time = index * 0.25;
    const energy = time >= 20 && time < 30 ? 0.85 : time >= 8 && time < 18 ? 0.55 : 0.15;
    frames.push({ time, energy, low: energy * 0.8, high: energy * 0.2 });
  }

  const summary = summarizeSegmentEnergies(frames, 50);
  const window = selectWarmupWindow(summary, frames, 8);

  assert.equal(window.start >= 18 && window.start <= 22, true);
  assert.equal(window.end - window.start, 8);
  assert.equal(window.reason, 'high-clarity-beat');
});

test('calibrates hidden warmup taps by snapping to the nearest tempo candidate', () => {
  const result = calibrateWarmupTaps({
    taps: [2.01, 2.5, 3.0, 3.49, 3.99],
    warmupStart: 2,
    tempoCandidates: [
      { bpm: 118, score: 0.6, source: 'energy-peak' },
      { bpm: 120, score: 0.92, source: 'autocorrelation' },
      { bpm: 60, score: 0.4, source: 'energy-peak' }
    ],
    suggestedDownbeat: 0
  });

  assert.equal(result.confirmed, true);
  assert.equal(result.selectedBpm, 120);
  assert.equal(result.halfDoubleRelation, 'none');
  assert.equal(result.tapStability > 0.9, true);
  assert.equal(Math.abs(result.selectedDownbeat) < 0.05, true);
});

test('detects double-time relation from warmup taps without exposing manual controls', () => {
  const result = calibrateWarmupTaps({
    taps: [4.0, 4.25, 4.5, 4.75, 5.0],
    warmupStart: 4,
    tempoCandidates: [
      { bpm: 60, score: 0.95, source: 'autocorrelation' },
      { bpm: 120, score: 0.7, source: 'energy-peak' }
    ],
    suggestedDownbeat: 0
  });

  assert.equal(result.selectedBpm, 120);
  assert.equal(result.halfDoubleRelation, 'double');
});
