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

  if (intervalCounts.size === 0) {
    return [{ bpm: 120, score: 0.1, source: 'energy-peak' }];
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
  if (frames.length === 0 || duration <= 0) {
    return [];
  }

  const targetSegmentCount = Math.max(3, Math.min(8, Math.round(duration / 18)));
  const minimumSegmentDuration = clamp(duration / (targetSegmentCount + 1), 3.5, 12);
  const boundaries = resolveSegmentBoundaries(frames, duration, targetSegmentCount, minimumSegmentDuration);
  const summaries = boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const range = resolveFrameRange(frames, start, end);
    const slice = frames.slice(range.start, range.end);
    const energy = average(slice.map((frame) => frame.energy));
    const lowFreqWeight = average(slice.map((frame) => frame.low));
    const highFreqWeight = average(slice.map((frame) => frame.high));
    const stability = 1 - normalizedStd(slice.map((frame) => frame.energy));
    return {
      start,
      end,
      label: 'verse' as MusicSegment['label'],
      energy,
      duration: end - start,
      beatDensity: clamp(energy * 0.7 + stability * 0.3, 0.2, 0.95),
      lowFreqWeight,
      highFreqWeight,
      stability
    };
  });

  return assignSegmentLabels(summaries);
}

export function selectWarmupWindow(
  segments: SegmentEnergySummary[],
  frames: EnergyFrame[],
  targetDuration: number
): WarmupWindow {
  if (frames.length === 0) {
    const fallbackEnd = Math.max(0, Math.min(targetDuration, segments[segments.length - 1]?.end ?? targetDuration));
    return {
      start: 0,
      end: fallbackEnd,
      reason: 'high-energy-stable-section'
    };
  }

  const availableDuration = Math.max(
    0,
    Math.max(
      segments[segments.length - 1]?.end ?? 0,
      frames[frames.length - 1]?.time ?? 0
    )
  );
  const windowDuration = Math.min(targetDuration, availableDuration);
  const frameStep = frames.length > 1 ? Math.max(0.25, frames[1].time - frames[0].time) : 0.25;
  const frameEnergies = frames.map((frame) => frame.energy);
  const energyPrefix = buildPrefixSums(frameEnergies);
  const squaredEnergyPrefix = buildPrefixSums(frameEnergies.map((value) => value * value));
  const searchEnd = Math.max(0, availableDuration - windowDuration);
  let bestStart = segments[0]?.start ?? 0;
  let bestScore = -Infinity;

  for (let start = 0; start <= searchEnd; start += frameStep) {
    const end = start + windowDuration;
    const range = resolveFrameRange(frames, start, end);
    if (range.count < 4) continue;
    const energy = (energyPrefix[range.end] - energyPrefix[range.start]) / range.count;
    const squaredAverage = (squaredEnergyPrefix[range.end] - squaredEnergyPrefix[range.start]) / range.count;
    const variance = Math.max(0, squaredAverage - energy * energy);
    const stability = 1 - Math.min(1, Math.sqrt(variance) / Math.max(0.0001, energy || 1));
    const score = energy * 0.8 + stability * 0.2;
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }

  const end = Math.min(availableDuration, bestStart + windowDuration);

  return {
    start: bestStart,
    end,
    reason: bestScore > 0.65 ? 'high-clarity-beat' : 'high-energy-stable-section'
  };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolveSegmentBoundaries(
  frames: EnergyFrame[],
  duration: number,
  targetSegmentCount: number,
  minimumSegmentDuration: number
): number[] {
  const novelty = frames.map((frame, index) => {
    if (index === 0) return 0;
    const previous = frames[index - 1];
    return (
      Math.abs(frame.energy - previous.energy) * 0.6 +
      Math.abs(frame.low - previous.low) * 0.25 +
      Math.abs(frame.high - previous.high) * 0.15
    );
  });
  const noveltyMean = average(novelty);
  const noveltyThreshold = noveltyMean + normalizedStd(novelty) * 0.35;
  const candidateCount = Math.max(0, targetSegmentCount - 1);
  const selected: number[] = [];

  const rankedPeaks = novelty
    .map((value, index) => ({ value, index, time: frames[index].time }))
    .filter((candidate) =>
      candidate.index > 1 &&
      candidate.index < frames.length - 2 &&
      candidate.value >= noveltyThreshold &&
      candidate.time >= minimumSegmentDuration &&
      duration - candidate.time >= minimumSegmentDuration
    )
    .sort((left, right) => right.value - left.value);

  for (const candidate of rankedPeaks) {
    if (selected.length >= candidateCount) break;
    if (selected.every((time) => Math.abs(time - candidate.time) >= minimumSegmentDuration)) {
      selected.push(candidate.time);
    }
  }

  if (selected.length < candidateCount) {
    const remaining = candidateCount - selected.length;
    const fallbackStep = duration / (remaining + 1);
    for (let index = 1; index <= remaining; index += 1) {
      const candidateTime = fallbackStep * index;
      if (
        candidateTime >= minimumSegmentDuration &&
        duration - candidateTime >= minimumSegmentDuration &&
        selected.every((time) => Math.abs(time - candidateTime) >= minimumSegmentDuration * 0.72)
      ) {
        selected.push(candidateTime);
      }
    }
  }

  return [0, ...selected.sort((left, right) => left - right), duration];
}

function assignSegmentLabels(summaries: SegmentEnergySummary[]): SegmentEnergySummary[] {
  if (summaries.length === 0) return summaries;

  const labeled = summaries.map((summary) => ({ ...summary }));
  const energyRanks = [...labeled]
    .map((summary, index) => ({ index, energy: summary.energy, low: summary.lowFreqWeight }))
    .sort((left, right) => (right.energy + right.low * 0.25) - (left.energy + left.low * 0.25));

  for (const summary of labeled) {
    summary.label = 'verse';
  }

  labeled[0].label = labeled.length === 1 ? 'verse' : 'intro';
  if (labeled.length > 1) {
    labeled[labeled.length - 1].label = labeled[labeled.length - 1].energy < 0.45 ? 'outro' : 'chorus';
  }

  const peakIndex = energyRanks[0]?.index ?? 0;
  labeled[peakIndex].label = labeled[peakIndex].energy > 0.82 ? 'drop' : 'chorus';

  if (energyRanks.length > 1) {
    const secondPeakIndex = energyRanks[1].index;
    if (secondPeakIndex !== peakIndex && labeled[secondPeakIndex].label === 'verse') {
      labeled[secondPeakIndex].label = 'chorus';
    }
  }

  for (let index = 1; index < labeled.length - 1; index += 1) {
    const previous = labeled[index - 1];
    const current = labeled[index];
    const next = labeled[index + 1];
    if (
      current.label === 'verse' &&
      next &&
      (next.label === 'chorus' || next.label === 'drop') &&
      current.energy >= previous.energy
    ) {
      current.label = 'bridge';
    }
  }

  return labeled;
}

function buildPrefixSums(values: number[]): number[] {
  const prefix = [0];
  for (const value of values) {
    prefix.push(prefix[prefix.length - 1] + value);
  }
  return prefix;
}

function resolveFrameRange(frames: EnergyFrame[], start: number, end: number): { start: number; end: number; count: number } {
  const startIndex = lowerBound(frames, start);
  const endIndex = lowerBound(frames, end);
  return {
    start: startIndex,
    end: endIndex,
    count: Math.max(0, endIndex - startIndex)
  };
}

function lowerBound(frames: EnergyFrame[], target: number): number {
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].time < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
