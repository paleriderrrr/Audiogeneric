import type { MusicSegment, TempoCandidate, WarmupWindow } from './types.js';

export interface EnergyFrame {
  time: number;
  energy: number;
  low: number;
  high: number;
}

export interface SegmentEnergySummary extends MusicSegment {
  duration: number;
  beatDensity: number;
  lowFreqWeight: number;
  highFreqWeight: number;
  stability: number;
}

export { calibrateWarmupTaps } from './calibration.js';

export function buildTempoCandidates(beatTimes: number[]): TempoCandidate[] {
  if (beatTimes.length < 2) {
    return [{ bpm: 120, score: 0.1, source: 'energy-peak' }];
  }

  const intervalCounts = new Map<number, number>();
  for (let index = 1; index < beatTimes.length; index += 1) {
    const interval = beatTimes[index] - beatTimes[index - 1];
    if (interval <= 0) continue;
    const bpm = clampTempo(60 / interval);
    intervalCounts.set(bpm, (intervalCounts.get(bpm) ?? 0) + 1);
  }

  const total = Math.max(1, beatTimes.length - 1);
  return [...intervalCounts.entries()]
    .map(([bpm, count], index) => ({
      bpm,
      score: count / total,
      source: (index === 0 ? 'autocorrelation' : 'energy-peak') as TempoCandidate['source']
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
}

export function summarizeSegmentEnergies(frames: EnergyFrame[], duration: number): SegmentEnergySummary[] {
  const segmentCount = Math.max(3, Math.min(8, Math.round(duration / 20)));
  const segmentLength = duration / segmentCount;
  const labels: MusicSegment['label'][] = ['intro', 'verse', 'chorus', 'bridge', 'drop', 'verse', 'chorus', 'outro'];

  return Array.from({ length: segmentCount }, (_, index) => {
    const start = index * segmentLength;
    const end = index === segmentCount - 1 ? duration : (index + 1) * segmentLength;
    const slice = frames.filter((frame) => frame.time >= start && frame.time < end);
    const energy = average(slice.map((frame) => frame.energy));
    const lowFreqWeight = average(slice.map((frame) => frame.low));
    const highFreqWeight = average(slice.map((frame) => frame.high));
    const stability = 1 - normalizedStd(slice.map((frame) => frame.energy));
    return {
      start,
      end,
      label: labels[index] ?? 'verse',
      energy,
      duration: end - start,
      beatDensity: energy > 0.7 ? 0.9 : energy > 0.4 ? 0.6 : 0.3,
      lowFreqWeight,
      highFreqWeight,
      stability
    };
  });
}

export function selectWarmupWindow(
  segments: SegmentEnergySummary[],
  frames: EnergyFrame[],
  targetDuration: number
): WarmupWindow {
  const frameStep = frames.length > 1 ? Math.max(0.25, frames[1].time - frames[0].time) : 0.25;
  const searchEnd = Math.max(0, (frames.length > 0 ? frames[frames.length - 1].time : segments[segments.length - 1]?.end ?? targetDuration) - targetDuration);
  let bestStart = segments[0]?.start ?? 0;
  let bestScore = -Infinity;

  for (let start = 0; start <= searchEnd; start += frameStep) {
    const end = start + targetDuration;
    const slice = frames.filter((frame) => frame.time >= start && frame.time < end);
    if (slice.length < 4) continue;
    const energy = average(slice.map((frame) => frame.energy));
    const stability = 1 - normalizedStd(slice.map((frame) => frame.energy));
    const score = energy * 0.8 + stability * 0.2;
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }

  const end = bestStart + targetDuration;

  return {
    start: bestStart,
    end,
    reason: bestScore > 0.65 ? 'high-clarity-beat' : 'high-energy-stable-section'
  };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizedStd(values: number[]): number {
  if (values.length === 0) return 1;
  const avg = average(values);
  const variance = values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / values.length;
  return Math.min(1, Math.sqrt(variance) / Math.max(0.0001, avg || 1));
}

function clampTempo(bpm: number): number {
  let value = bpm;
  while (value > 180) value /= 2;
  while (value < 60) value *= 2;
  return Math.round(value);
}
