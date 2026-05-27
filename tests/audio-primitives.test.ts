import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMusicPrimitives } from '../src/audio/primitives.js';
import type { SegmentEnergySummary } from '../src/audio/pipeline.js';

test('extracts bass bright flux dense stable and climax primitives from spectrum summaries', () => {
  const primitives = extractMusicPrimitives([
    segment({ start: 0, end: 8, label: 'verse', energy: 0.62, lowFreqWeight: 0.68, highFreqWeight: 0.12, spectralFlux: 0.2, beatDensity: 0.68, stability: 0.72, intensity: 0.66 }),
    segment({ start: 8, end: 16, label: 'bridge', energy: 0.58, lowFreqWeight: 0.14, highFreqWeight: 0.66, spectralCentroid: 0.72, spectralFlux: 0.28, beatDensity: 0.62, stability: 0.7, intensity: 0.65 }),
    segment({ start: 16, end: 24, label: 'chorus', energy: 0.74, lowFreqWeight: 0.3, highFreqWeight: 0.36, spectralFlux: 0.86, beatDensity: 0.78, stability: 0.38, intensity: 0.82 }),
    segment({ start: 24, end: 32, label: 'drop', energy: 0.94, lowFreqWeight: 0.52, highFreqWeight: 0.46, spectralFlux: 0.74, beatDensity: 0.92, stability: 0.48, intensity: 0.96 }),
    segment({ start: 32, end: 40, label: 'outro', energy: 0.36, lowFreqWeight: 0.24, highFreqWeight: 0.18, spectralFlux: 0.12, beatDensity: 0.42, stability: 0.88, intensity: 0.4 })
  ]);

  const kinds = new Set(primitives.map((primitive) => primitive.kind));

  assert.equal(kinds.has('bass-impact'), true);
  assert.equal(kinds.has('bright-beam'), true);
  assert.equal(kinds.has('flux-break'), true);
  assert.equal(kinds.has('dense-pressure'), true);
  assert.equal(kinds.has('stable-groove'), true);
  assert.equal(kinds.has('climax'), true);
  assert.equal(primitives.every((primitive) => primitive.strength >= 0 && primitive.strength <= 1), true);
  assert.equal(primitives.every((primitive) => primitive.confidence >= 0 && primitive.confidence <= 1), true);
  assert.equal(primitives.every((primitive) => primitive.id.includes(primitive.kind)), true);
});

test('keeps only strong primitive signals and sorts them chronologically by strength', () => {
  const primitives = extractMusicPrimitives([
    segment({ start: 0, end: 8, label: 'verse', energy: 0.18, lowFreqWeight: 0.12, highFreqWeight: 0.1, spectralFlux: 0.08, beatDensity: 0.18, stability: 0.42, intensity: 0.16 }),
    segment({ start: 8, end: 16, label: 'chorus', energy: 0.82, lowFreqWeight: 0.2, highFreqWeight: 0.68, spectralCentroid: 0.78, spectralFlux: 0.72, beatDensity: 0.86, stability: 0.52, intensity: 0.9 })
  ]);

  assert.equal(primitives.some((primitive) => primitive.start < 8), false);
  assert.equal(primitives[0].start, 8);
  assert.equal(primitives[0].strength >= primitives[primitives.length - 1].strength || primitives[primitives.length - 1].start > primitives[0].start, true);
});

test('limits each segment to the strongest three primitives for prompt compactness', () => {
  const primitives = extractMusicPrimitives([
    segment({
      start: 0,
      end: 16,
      label: 'drop',
      energy: 0.96,
      lowFreqWeight: 0.58,
      highFreqWeight: 0.56,
      spectralCentroid: 0.66,
      spectralFlux: 0.86,
      beatDensity: 0.94,
      stability: 0.42,
      intensity: 0.98
    })
  ]);

  assert.equal(primitives.length <= 3, true);
  assert.equal(primitives.some((primitive) => primitive.kind === 'climax'), true);
});

function segment(overrides: Partial<SegmentEnergySummary>): SegmentEnergySummary {
  return {
    start: 0,
    end: 8,
    label: 'verse',
    energy: 0.5,
    duration: 8,
    beatDensity: 0.5,
    lowFreqWeight: 0.3,
    highFreqWeight: 0.3,
    stability: 0.6,
    spectralCentroid: 0.4,
    spectralFlux: 0.3,
    intensity: 0.5,
    ...overrides
  };
}
