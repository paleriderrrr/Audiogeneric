import type { CalibrationResult, TempoCandidate } from './types.js';

const MIN_CONFIRMED_TAPS = 8;
const MIN_TAP_INTERVAL_SECONDS = 0.12;

export function calibrateWarmupTaps(input: {
  taps: number[];
  warmupStart: number;
  tempoCandidates: TempoCandidate[];
  suggestedDownbeat: number;
}): CalibrationResult {
  const taps = normalizeTaps(input.taps);
  if (taps.length < MIN_CONFIRMED_TAPS) {
    return {
      taps,
      tapDerivedBpm: 0,
      selectedBpm: input.tempoCandidates[0]?.bpm ?? 120,
      selectedDownbeat: input.suggestedDownbeat,
      halfDoubleRelation: 'none',
      tapStability: 0,
      confirmed: false
    };
  }

  const intervals: number[] = [];
  for (let index = 1; index < taps.length; index += 1) {
    intervals.push(taps[index] - taps[index - 1]);
  }
  const medianInterval = median(intervals);
  if (!Number.isFinite(medianInterval) || medianInterval <= 0) {
    return {
      taps,
      tapDerivedBpm: 0,
      selectedBpm: input.tempoCandidates[0]?.bpm ?? 120,
      selectedDownbeat: input.suggestedDownbeat,
      halfDoubleRelation: 'none',
      tapStability: 0,
      confirmed: false
    };
  }
  const tapDerivedBpm = 60 / medianInterval;
  const candidate = selectCandidate(tapDerivedBpm, input.tempoCandidates);
  const selectedBpm = candidate.matchedBpm;
  const beatDuration = 60 / selectedBpm;
  const relativeOffsets = taps.map((tap, index) => tap - index * beatDuration);
  const selectedDownbeat = normalizeModulo(median(relativeOffsets), beatDuration, input.suggestedDownbeat);
  const variance = intervals.reduce((sum, interval) => sum + Math.pow(interval - medianInterval, 2), 0) / intervals.length;
  const tapStability = Math.max(0, 1 - Math.sqrt(variance) / Math.max(0.001, medianInterval));

  return {
    taps,
    tapDerivedBpm,
    selectedBpm,
    selectedDownbeat,
    halfDoubleRelation: candidate.relation,
    tapStability,
    confirmed: taps.length >= MIN_CONFIRMED_TAPS && tapStability > 0.7
  };
}

function selectCandidate(tapDerivedBpm: number, candidates: TempoCandidate[]): {
  matchedBpm: number;
  relation: 'none' | 'half' | 'double';
} {
  let best: { matchedBpm: number; relation: 'none' | 'half' | 'double'; error: number; score: number } = {
    matchedBpm: clampTempo(tapDerivedBpm),
    relation: 'none',
    error: Infinity,
    score: 0
  };

  for (const candidate of candidates) {
    const options = [
      { bpm: candidate.bpm, relation: 'none' as const },
      { bpm: candidate.bpm * 2, relation: 'double' as const },
      { bpm: candidate.bpm / 2, relation: 'half' as const }
    ];
    for (const option of options) {
      const bpm = clampTempo(option.bpm);
      const error = Math.abs(bpm - tapDerivedBpm);
      if (error < best.error || (Math.abs(error - best.error) < 0.01 && candidate.score > best.score)) {
        best = { matchedBpm: bpm, relation: option.relation, error, score: candidate.score };
      }
    }
  }

  return { matchedBpm: best.matchedBpm, relation: best.relation };
}

function clampTempo(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return 120;
  let value = bpm;
  while (value > 180) value /= 2;
  while (value < 60) value *= 2;
  return Math.round(value);
}

function normalizeTaps(taps: number[]): number[] {
  return taps
    .filter((tap) => Number.isFinite(tap))
    .sort((a, b) => a - b)
    .filter((tap, index, sorted) => index === 0 || tap - sorted[index - 1] >= MIN_TAP_INTERVAL_SECONDS);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function normalizeModulo(value: number, duration: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const mod = value % duration;
  return mod < 0 ? mod + duration : mod;
}
