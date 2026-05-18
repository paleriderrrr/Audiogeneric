import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTempoCandidates,
  calibrateWarmupTaps,
  inferTrackStyleProfile,
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

test('clamps warmup windows to the available audio duration', () => {
  const frames: EnergyFrame[] = [
    { time: 0, energy: 0.6, low: 0.3, high: 0.2 },
    { time: 0.25, energy: 0.7, low: 0.4, high: 0.2 },
    { time: 0.5, energy: 0.65, low: 0.3, high: 0.2 },
    { time: 0.75, energy: 0.62, low: 0.3, high: 0.2 }
  ];
  const summary = summarizeSegmentEnergies(frames, 1);

  const window = selectWarmupWindow(summary, frames, 8);

  assert.equal(window.start, 0);
  assert.equal(window.end, 1);
});

test('infers electronic style from fast stable high-frequency frames', () => {
  const frames: EnergyFrame[] = Array.from({ length: 80 }, (_, index) => ({
    time: index * 0.125,
    energy: index % 2 === 0 ? 0.82 : 0.74,
    low: 0.28,
    high: 0.86
  }));
  const segments = summarizeSegmentEnergies(frames, 10);

  const profile = inferTrackStyleProfile({
    bpm: 148,
    beats: Array.from({ length: 24 }, (_, index) => ({ time: index * 0.4, strength: 0.8 })),
    frames,
    segments
  });

  assert.equal(profile.primaryStyle, 'electronic');
  assert.equal(profile.beatDensity > 0.8, true);
  assert.equal(profile.descriptors.includes('short-fast-pulses'), true);
});

test('infers rock style from energetic low-mid weighted frames with high contrast', () => {
  const frames: EnergyFrame[] = Array.from({ length: 80 }, (_, index) => {
    const loud = index % 8 < 4;
    return {
      time: index * 0.25,
      energy: loud ? 0.92 : 0.35,
      low: loud ? 0.82 : 0.38,
      high: loud ? 0.48 : 0.22
    };
  });
  const segments = summarizeSegmentEnergies(frames, 20);

  const profile = inferTrackStyleProfile({
    bpm: 124,
    beats: Array.from({ length: 24 }, (_, index) => ({ time: index * 0.5, strength: index % 2 === 0 ? 1 : 0.65 })),
    frames,
    segments
  });

  assert.equal(profile.primaryStyle, 'rock');
  assert.equal(profile.dynamicRange > 0.4, true);
  assert.equal(profile.descriptors.includes('wide-impact-hits'), true);
});
