import type { MusicPrimitive, MusicPrimitiveKind, MusicSegment } from './types.js';

interface PrimitiveSegment extends MusicSegment {
  beatDensity?: number;
  lowFreqWeight?: number;
  highFreqWeight?: number;
  stability?: number;
  spectralCentroid?: number;
  spectralFlux?: number;
  intensity?: number;
}

const MIN_PRIMITIVE_STRENGTH = 0.48;

export function extractMusicPrimitives(segments: PrimitiveSegment[]): MusicPrimitive[] {
  return segments
    .flatMap((segment, segmentIndex) => {
      const features = normalizeFeatures(segment);
      const scores: Array<{ kind: MusicPrimitiveKind; strength: number }> = [
        {
          kind: 'bass-impact',
          strength: clamp01(
            Math.max(0, features.lowFreqWeight - features.highFreqWeight) * 0.8
            + features.energy * 0.25
            + features.intensity * 0.25
            + features.beatDensity * 0.12
          )
        },
        {
          kind: 'bright-beam',
          strength: clamp01(
            Math.max(0, features.highFreqWeight - features.lowFreqWeight) * 0.8
            + (features.spectralCentroid ?? 0) * 0.22
            + features.energy * 0.18
            + features.spectralFlux * 0.18
            + features.intensity * 0.12
          )
        },
        {
          kind: 'flux-break',
          strength: clamp01(
            features.spectralFlux * 0.64
            + (1 - features.stability) * 0.18
            + features.intensity * 0.2
          )
        },
        {
          kind: 'dense-pressure',
          strength: clamp01(
            features.beatDensity * 0.36
            + features.energy * 0.22
            + features.intensity * 0.28
            + (1 - features.stability) * 0.12
          )
        },
        {
          kind: 'stable-groove',
          strength: clamp01(
            features.stability * 0.5
            + features.beatDensity * 0.22
            + features.energy * 0.2
            - features.spectralFlux * 0.12
          )
        },
        {
          kind: 'climax',
          strength: clamp01(
            features.energy * 0.3
            + features.intensity * 0.34
            + features.beatDensity * 0.16
            + features.spectralFlux * 0.12
            + (segment.label === 'drop' || segment.label === 'chorus' ? 0.1 : 0)
          )
        }
      ];

      return selectSegmentPrimitives(scores)
        .map((score) => ({
          id: `p${segmentIndex}-${score.kind}`,
          kind: score.kind,
          start: roundTime(segment.start),
          end: roundTime(segment.end),
          segmentIndex,
          strength: roundMetric(score.strength),
          confidence: roundMetric(resolveConfidence(score.strength, features)),
          features
        }));
    })
    .sort((left, right) => left.start - right.start || right.strength - left.strength || left.kind.localeCompare(right.kind));
}

function selectSegmentPrimitives(
  scores: Array<{ kind: MusicPrimitiveKind; strength: number }>
): Array<{ kind: MusicPrimitiveKind; strength: number }> {
  return scores
    .filter((score) => score.strength >= MIN_PRIMITIVE_STRENGTH)
    .sort((left, right) => right.strength - left.strength || left.kind.localeCompare(right.kind))
    .slice(0, 3);
}

function normalizeFeatures(segment: PrimitiveSegment): MusicPrimitive['features'] {
  const lowFreqWeight = clamp01(segment.lowFreqWeight ?? segment.energy * 0.55);
  const highFreqWeight = clamp01(segment.highFreqWeight ?? segment.energy * 0.35);
  const stability = clamp01(segment.stability ?? 0.65);
  const spectralCentroid = clamp01(segment.spectralCentroid ?? estimateSpectralCentroid(lowFreqWeight, highFreqWeight));
  const spectralFlux = clamp01(segment.spectralFlux ?? 0);
  const beatDensity = clamp01(segment.beatDensity ?? segment.energy * 0.65 + stability * 0.25);
  const intensity = clamp01(segment.intensity ?? (
    segment.energy * 0.42
    + beatDensity * 0.18
    + lowFreqWeight * 0.13
    + highFreqWeight * 0.12
    + spectralFlux * 0.15
  ));

  return {
    energy: roundMetric(clamp01(segment.energy)),
    lowFreqWeight: roundMetric(lowFreqWeight),
    highFreqWeight: roundMetric(highFreqWeight),
    spectralCentroid: roundMetric(spectralCentroid),
    spectralFlux: roundMetric(spectralFlux),
    beatDensity: roundMetric(beatDensity),
    stability: roundMetric(stability),
    intensity: roundMetric(intensity)
  };
}

function resolveConfidence(strength: number, features: MusicPrimitive['features']): number {
  const featureCompleteness = [
    features.lowFreqWeight,
    features.highFreqWeight,
    features.spectralFlux,
    features.beatDensity,
    features.stability,
    features.intensity
  ].filter(Number.isFinite).length / 6;
  return clamp01(strength * 0.7 + featureCompleteness * 0.3);
}

function estimateSpectralCentroid(low: number, high: number): number {
  const total = Math.max(0.0001, low + high);
  return clamp01((high * 0.72 + low * 0.18) / total);
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
