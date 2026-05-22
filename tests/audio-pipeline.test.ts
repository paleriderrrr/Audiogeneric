import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTempoCandidates,
  calibrateWarmupTaps,
  selectWarmupWindow,
  summarizeSegmentEnergies,
  type EnergyFrame
} from '../src/audio/pipeline.js';
import { analyzeDecodedAudio, buildEnergyFrames } from '../src/audio/analysis-core.js';

test('builds ranked tempo candidates from beat intervals', () => {
  const candidates = buildTempoCandidates([0.5, 1.0, 1.5, 2.0, 2.5]);

  assert.equal(candidates.length > 0, true);
  assert.equal(candidates[0].bpm, 120);
  assert.equal(candidates[0].score >= candidates[candidates.length - 1].score, true);
});

test('falls back to a default tempo candidate when beat intervals are invalid', () => {
  const candidates = buildTempoCandidates([1, 1, 1, 1]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].bpm, 120);
  assert.equal(candidates[0].score > 0, true);
});

test('extracts low and high frequency energy with FFT bands', () => {
  const sampleRate = 44100;
  const lowFrames = buildEnergyFrames(createToneSamples(110, sampleRate, 1.2), sampleRate);
  const highFrames = buildEnergyFrames(createToneSamples(4200, sampleRate, 1.2), sampleRate);
  const lowAverage = average(lowFrames.map((frame) => frame.low));
  const lowHighAverage = average(lowFrames.map((frame) => frame.high));
  const highAverage = average(highFrames.map((frame) => frame.high));
  const highLowAverage = average(highFrames.map((frame) => frame.low));
  const lowCentroid = average(lowFrames.map((frame) => frame.spectralCentroid ?? 0));
  const highCentroid = average(highFrames.map((frame) => frame.spectralCentroid ?? 0));

  assert.equal(lowAverage > lowHighAverage * 3, true);
  assert.equal(highAverage > highLowAverage * 3, true);
  assert.equal(highCentroid > lowCentroid * 8, true);
});

test('captures spectral flux at abrupt frequency transitions', () => {
  const sampleRate = 44100;
  const samples = new Float32Array(Math.floor(sampleRate * 2.4));
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    const frequency = time < 1.2 ? 140 : 3600;
    samples[index] = Math.sin(Math.PI * 2 * frequency * time) * 0.8;
  }

  const frames = buildEnergyFrames(samples, sampleRate);
  const transitionFlux = Math.max(...frames
    .filter((frame) => frame.time >= 1.0 && frame.time <= 1.45)
    .map((frame) => frame.spectralFlux ?? 0));
  const stableFlux = average(frames
    .filter((frame) => frame.time < 0.75)
    .map((frame) => frame.spectralFlux ?? 0));

  assert.equal(transitionFlux > stableFlux + 0.45, true);
});

test('analyzes phase-inverted stereo pulses without downmix cancellation', () => {
  const sampleRate = 44100;
  const left = createPulseSamples(120, sampleRate, 12);
  const right = new Float32Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    right[index] = -left[index];
  }

  const analysis = analyzeDecodedAudio({
    duration: 12,
    length: left.length,
    numberOfChannels: 2,
    sampleRate,
    getChannelData(channelIndex: number) {
      return channelIndex === 0 ? left : right;
    }
  }, () => undefined);

  assert.equal(analysis.beats.length >= 8, true);
  assert.equal(analysis.bpm >= 100 && analysis.bpm <= 140, true);
  assert.equal(analysis.segments.length >= 3, true);
});

function createToneSamples(frequency: number, sampleRate: number, duration: number): Float32Array {
  const samples = new Float32Array(Math.floor(sampleRate * duration));
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    samples[index] = Math.sin(Math.PI * 2 * frequency * time) * 0.8;
  }
  return samples;
}

function createPulseSamples(bpm: number, sampleRate: number, duration: number): Float32Array {
  const samples = new Float32Array(Math.floor(sampleRate * duration));
  const beatInterval = 60 / bpm;
  const pulseLength = 0.06;
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    const beatPhase = time % beatInterval;
    if (beatPhase >= pulseLength) continue;
    const envelope = 1 - beatPhase / pulseLength;
    const tone = Math.sin(Math.PI * 2 * 110 * time) * envelope;
    const harmonic = Math.sin(Math.PI * 2 * 220 * time) * envelope * 0.4;
    samples[index] = (tone + harmonic) * 0.85;
  }
  return samples;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

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

test('clamps the warmup window to the available track duration', () => {
  const frames: EnergyFrame[] = [];
  for (let index = 0; index < 20; index += 1) {
    const time = index * 0.25;
    frames.push({ time, energy: 0.7, low: 0.5, high: 0.2 });
  }

  const summary = summarizeSegmentEnergies(frames, 5);
  const window = selectWarmupWindow(summary, frames, 8);

  assert.equal(window.start, 0);
  assert.equal(window.end <= 5, true);
  assert.equal(window.end - window.start, 5);
});

test('segments sustained structural changes instead of only slicing evenly', () => {
  const frames: EnergyFrame[] = [];
  for (let index = 0; index < 1200; index += 1) {
    const time = index * 0.05;
    const profile = time < 12
      ? { energy: 0.18, low: 0.12, high: 0.08, centroid: 0.18, flux: 0.08 }
      : time < 28
        ? { energy: 0.58, low: 0.42, high: 0.22, centroid: 0.28, flux: 0.18 }
        : time < 44
          ? { energy: 0.35, low: 0.16, high: 0.48, centroid: 0.62, flux: 0.32 }
          : { energy: 0.78, low: 0.62, high: 0.3, centroid: 0.32, flux: 0.36 };
    const pulse = Math.sin(time * Math.PI * 2) > 0.92 ? 0.08 : 0;
    const nearTransition = [12, 28, 44].some((boundary) => Math.abs(time - boundary) <= 0.25);
    frames.push({
      time,
      energy: Math.min(1, profile.energy + pulse),
      low: Math.min(1, profile.low + pulse * 0.7),
      high: Math.min(1, profile.high + pulse * 0.4),
      spectralCentroid: profile.centroid,
      spectralFlux: nearTransition ? 0.72 : profile.flux
    });
  }

  const summary = summarizeSegmentEnergies(frames, 60);
  const boundaries = summary.slice(1).map((segment) => segment.start);

  assert.equal(boundaries.some((time) => Math.abs(time - 12) <= 1), true);
  assert.equal(boundaries.some((time) => Math.abs(time - 28) <= 1), true);
  assert.equal(boundaries.some((time) => Math.abs(time - 44) <= 1), true);
  assert.equal(summary.every((segment) => Number.isFinite(segment.intensity)), true);
  assert.equal(summary.some((segment) => segment.spectralFlux > 0.25), true);
  assert.equal(summary.some((segment) => segment.spectralCentroid > 0.1), true);
});

test('uses detected beat phrases when structural peaks are ambiguous', () => {
  const frames: EnergyFrame[] = [];
  for (let index = 0; index < 1280; index += 1) {
    const time = index * 0.05;
    const pulse = Math.sin(time * Math.PI * 4) > 0.92 ? 0.04 : 0;
    frames.push({
      time,
      energy: 0.42 + pulse,
      low: 0.26 + pulse * 0.5,
      high: 0.18 + pulse * 0.4
    });
  }
  const beatTimes = Array.from({ length: 128 }, (_, index) => Number((index * 0.5).toFixed(3)));

  const summary = summarizeSegmentEnergies(frames, 64, beatTimes);
  const boundaries = summary.slice(1).map((segment) => segment.start);

  assert.equal(boundaries.some((time) => Math.abs(time - 16) < 0.001), true);
  assert.equal(boundaries.some((time) => Math.abs(time - 32) < 0.001), true);
  assert.equal(boundaries.some((time) => Math.abs(time - 48) < 0.001), true);
});

test('fills fallback phrase boundaries even when a detected peak occupies one ideal slot', () => {
  const frames: EnergyFrame[] = [];
  for (let index = 0; index < 1400; index += 1) {
    const time = index * 0.05;
    const isAfterDrop = time >= 16;
    const pulse = Math.sin(time * Math.PI * 4) > 0.94 ? 0.04 : 0;
    frames.push({
      time,
      energy: (isAfterDrop ? 0.72 : 0.24) + pulse,
      low: (isAfterDrop ? 0.48 : 0.16) + pulse * 0.5,
      high: (isAfterDrop ? 0.22 : 0.12) + pulse * 0.4
    });
  }
  const beatTimes = Array.from({ length: 140 }, (_, index) => Number((index * 0.5).toFixed(3)));

  const summary = summarizeSegmentEnergies(frames, 70, beatTimes);
  const boundaries = summary.slice(1).map((segment) => segment.start);

  assert.equal(summary.length >= 5, true);
  assert.equal(boundaries.some((time) => Math.abs(time - 16) <= 0.5), true);
  assert.equal(boundaries.some((time) => Math.abs(time - 32) <= 0.5), true);
  assert.equal(boundaries.some((time) => Math.abs(time - 48) <= 0.5), true);
  assert.equal(boundaries.filter((time) => ![16, 32, 48].some((expected) => Math.abs(time - expected) <= 0.5)).length >= 1, true);
});

test('calibrates hidden warmup taps by snapping to the nearest tempo candidate', () => {
  const result = calibrateWarmupTaps({
    taps: [2.01, 2.5, 3.0, 3.49, 3.99, 4.5, 5.0, 5.49, 5.99, 6.5],
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
    taps: [4.0, 4.25, 4.5, 4.75, 5.0, 5.25, 5.5, 5.75, 6.0],
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

test('requires enough warmup taps before confirming calibration', () => {
  const result = calibrateWarmupTaps({
    taps: [2.0, 2.5, 3.0, 3.5, 4.0],
    warmupStart: 2,
    tempoCandidates: [{ bpm: 120, score: 1, source: 'autocorrelation' }],
    suggestedDownbeat: 0
  });

  assert.equal(result.confirmed, false);
  assert.equal(result.tapStability, 0);
});

test('ignores duplicate warmup taps without producing invalid tempo', () => {
  const result = calibrateWarmupTaps({
    taps: [2, 2, 2.02, 2.5, 3, 3.01, 3.5, 4, 4.5, 5, Number.POSITIVE_INFINITY],
    warmupStart: 2,
    tempoCandidates: [{ bpm: 120, score: 1, source: 'autocorrelation' }],
    suggestedDownbeat: 0
  });

  assert.equal(Number.isFinite(result.selectedBpm), true);
  assert.equal(result.taps.every(Number.isFinite), true);
  assert.equal(result.taps.length < 8, true);
  assert.equal(result.confirmed, false);
});
