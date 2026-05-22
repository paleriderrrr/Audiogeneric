import type { MusicSegment, TempoCandidate, WarmupWindow } from './types.js';

export interface EnergyFrame {
  time: number;
  energy: number;
  low: number;
  high: number;
  spectralCentroid?: number;
  spectralFlux?: number;
}

export interface SegmentEnergySummary extends MusicSegment {
  duration: number;
  beatDensity: number;
  lowFreqWeight: number;
  highFreqWeight: number;
  stability: number;
  spectralCentroid: number;
  spectralFlux: number;
  intensity: number;
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

export function summarizeSegmentEnergies(
  frames: EnergyFrame[],
  duration: number,
  beatTimes: number[] = []
): SegmentEnergySummary[] {
  if (frames.length === 0 || duration <= 0) {
    return [];
  }

  const targetSegmentCount = Math.max(4, Math.min(10, Math.round(duration / 14)));
  const minimumSegmentDuration = clamp(duration / (targetSegmentCount + 1), 4, 10);
  const boundaries = resolveSegmentBoundaries(frames, duration, targetSegmentCount, minimumSegmentDuration, beatTimes);
  const metrics = buildFrameMetrics(frames);
  const normalizedBeatTimes = normalizeTimeGrid(beatTimes, duration);
  const summaries = boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const range = resolveFrameRange(frames, start, end);
    const energy = averageFromPrefix(metrics.energy, range);
    const lowFreqWeight = averageFromPrefix(metrics.low, range);
    const highFreqWeight = averageFromPrefix(metrics.high, range);
    const spectralCentroid = averageFromPrefix(metrics.spectralCentroid, range);
    const spectralFlux = averageFromPrefix(metrics.spectralFlux, range);
    const stability = 1 - normalizedStdFromPrefixes(metrics.energy, metrics.energySquared, range);
    const beatDensity = resolveBeatDensity(normalizedBeatTimes, start, end, energy, stability);
    const intensity = clamp(
      energy * 0.42
      + beatDensity * 0.18
      + lowFreqWeight * 0.13
      + highFreqWeight * 0.12
      + spectralFlux * 0.15,
      0,
      1
    );
    return {
      start,
      end,
      label: 'verse' as MusicSegment['label'],
      energy,
      duration: end - start,
      beatDensity,
      lowFreqWeight,
      highFreqWeight,
      stability,
      spectralCentroid,
      spectralFlux,
      intensity
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

function buildFrameMetrics(frames: EnergyFrame[]): {
  energy: number[];
  energySquared: number[];
  low: number[];
  high: number[];
  spectralCentroid: number[];
  spectralFlux: number[];
} {
  const energy = buildPrefixSums(frames.map((frame) => frame.energy));
  return {
    energy,
    energySquared: buildPrefixSums(frames.map((frame) => frame.energy * frame.energy)),
    low: buildPrefixSums(frames.map((frame) => frame.low)),
    high: buildPrefixSums(frames.map((frame) => frame.high)),
    spectralCentroid: buildPrefixSums(frames.map((frame) => frame.spectralCentroid ?? estimateSpectralCentroid(frame))),
    spectralFlux: buildPrefixSums(frames.map((frame) => frame.spectralFlux ?? 0))
  };
}

function averageFromPrefix(
  prefix: number[],
  range: { start: number; end: number; count: number }
): number {
  return range.count === 0 ? 0 : (prefix[range.end] - prefix[range.start]) / range.count;
}

function estimateSpectralCentroid(frame: EnergyFrame): number {
  const total = Math.max(0.0001, frame.low + frame.high);
  return clamp((frame.high * 0.72 + frame.low * 0.18) / total, 0, 1);
}

function resolveBeatDensity(
  beatTimes: number[],
  start: number,
  end: number,
  energy: number,
  stability: number
): number {
  const duration = Math.max(0.001, end - start);
  if (beatTimes.length === 0) {
    return clamp(energy * 0.7 + stability * 0.3, 0.2, 0.95);
  }
  const beatsInRange = lowerBoundNumber(beatTimes, end) - lowerBoundNumber(beatTimes, start);
  const densityPerSecond = beatsInRange / duration;
  return clamp(densityPerSecond / 4, 0.08, 1);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function resolveSegmentBoundaries(
  frames: EnergyFrame[],
  duration: number,
  targetSegmentCount: number,
  minimumSegmentDuration: number,
  beatTimes: number[]
): number[] {
  const novelty = buildStructuralNovelty(frames);
  const noveltyMean = average(novelty);
  const noveltyThreshold = noveltyMean + normalizedStd(novelty) * 0.2;
  const candidateCount = Math.max(0, targetSegmentCount - 1);
  const selected: number[] = [];
  const normalizedBeatTimes = normalizeTimeGrid(beatTimes, duration);
  const detectedBeatTimes = normalizedBeatTimes.length > 0 ? normalizedBeatTimes : inferStrongBeatTimes(frames);

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
    const snappedTime = snapToNearestTime(candidate.time, detectedBeatTimes, 0.35);
    if (selected.every((time) => Math.abs(time - snappedTime) >= minimumSegmentDuration)) {
      selected.push(snappedTime);
    }
  }

  if (selected.length < candidateCount) {
    const relaxedMinimumDuration = Math.min(
      minimumSegmentDuration,
      Math.max(2, duration / (targetSegmentCount + 1))
    );
    const phraseCandidates = buildPhraseBoundaryCandidates(detectedBeatTimes, duration, relaxedMinimumDuration);
    const idealSlots = Array.from(
      { length: candidateCount },
      (_, index) => (duration / (candidateCount + 1)) * (index + 1)
    );
    for (const idealTime of idealSlots) {
      if (selected.length >= candidateCount) break;
      const candidateTime = pickFallbackBoundary(idealTime, phraseCandidates, selected, relaxedMinimumDuration)
        ?? snapToNearestTime(idealTime, detectedBeatTimes, 0.45);
      appendCandidateBoundary(selected, candidateTime, duration, relaxedMinimumDuration);
    }

    if (selected.length < candidateCount && relaxedMinimumDuration > 4) {
      const fillMinimumDuration = Math.max(4, relaxedMinimumDuration * 0.65);
      const densePhraseCandidates = buildPhraseBoundaryCandidates(detectedBeatTimes, duration, fillMinimumDuration);
      for (const idealTime of idealSlots) {
        if (selected.length >= candidateCount) break;
        const candidateTime = pickFallbackBoundary(idealTime, densePhraseCandidates, selected, fillMinimumDuration)
          ?? snapToNearestTime(idealTime, detectedBeatTimes, 0.45);
        appendCandidateBoundary(selected, candidateTime, duration, fillMinimumDuration);
      }
    }
  }

  return [0, ...selected.sort((left, right) => left - right), duration];
}

function appendCandidateBoundary(
  selected: number[],
  candidateTime: number,
  duration: number,
  minimumSegmentDuration: number
): boolean {
  if (
    candidateTime >= minimumSegmentDuration &&
    duration - candidateTime >= minimumSegmentDuration &&
    selected.every((time) => Math.abs(time - candidateTime) >= minimumSegmentDuration)
  ) {
    selected.push(candidateTime);
    return true;
  }
  return false;
}

function normalizeTimeGrid(times: number[], duration: number): number[] {
  return [...new Set(times
    .filter((time) => Number.isFinite(time) && time >= 0 && time <= duration)
    .map((time) => Math.round(time * 1000) / 1000))]
    .sort((left, right) => left - right);
}

function buildPhraseBoundaryCandidates(
  beatTimes: number[],
  duration: number,
  minimumSegmentDuration: number
): number[] {
  if (beatTimes.length < 8) return [];
  const intervals = beatTimes
    .slice(1)
    .map((time, index) => time - beatTimes[index])
    .filter((interval) => Number.isFinite(interval) && interval > 0);
  const medianInterval = median(intervals);
  const phraseBeats = medianInterval * 32 <= minimumSegmentDuration * 1.8 ? 32 : 16;
  const candidates = new Set<number>();

  for (let index = phraseBeats; index < beatTimes.length; index += phraseBeats) {
    const time = beatTimes[index];
    if (time >= minimumSegmentDuration && duration - time >= minimumSegmentDuration) {
      candidates.add(Math.round(time * 1000) / 1000);
    }
  }

  const halfPhrase = Math.max(8, phraseBeats / 2);
  for (let index = halfPhrase; index < beatTimes.length; index += phraseBeats) {
    const time = beatTimes[index];
    if (time >= minimumSegmentDuration && duration - time >= minimumSegmentDuration) {
      candidates.add(Math.round(time * 1000) / 1000);
    }
  }

  return [...candidates].sort((left, right) => left - right);
}

function pickFallbackBoundary(
  idealTime: number,
  candidates: number[],
  selected: number[],
  minimumSegmentDuration: number
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (!selected.every((time) => Math.abs(time - candidate) >= minimumSegmentDuration)) continue;
    const distance = Math.abs(candidate - idealTime);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function buildStructuralNovelty(frames: EnergyFrame[]): number[] {
  const frameStep = resolveFrameStep(frames);
  const shortWindow = Math.max(1, Math.round(0.25 / frameStep));
  const longWindow = Math.max(shortWindow + 1, Math.round(1.2 / frameStep));
  const energy = smoothSeries(frames.map((frame) => frame.energy), shortWindow);
  const low = smoothSeries(frames.map((frame) => frame.low), shortWindow);
  const high = smoothSeries(frames.map((frame) => frame.high), shortWindow);
  const series = {
    energy: buildPrefixSums(energy),
    low: buildPrefixSums(low),
    high: buildPrefixSums(high)
  };

  return frames.map((_, index) => {
    const before = resolveWindowStats(series, Math.max(0, index - longWindow), index);
    const after = resolveWindowStats(series, index, Math.min(frames.length, index + longWindow));
    const energyShift = Math.abs(after.energy - before.energy);
    const lowShift = Math.abs(after.low - before.low);
    const highShift = Math.abs(after.high - before.high);
    const spectralShift = Math.abs((after.high - after.low) - (before.high - before.low));
    const localImpact = Math.abs(energy[index] - (energy[index - 1] ?? energy[index]));
    return energyShift * 0.42 + lowShift * 0.22 + highShift * 0.18 + spectralShift * 0.13 + localImpact * 0.05;
  });
}

function resolveWindowStats(
  series: { energy: number[]; low: number[]; high: number[] },
  start: number,
  end: number
): { energy: number; low: number; high: number } {
  return {
    energy: averageFromBounds(series.energy, start, end),
    low: averageFromBounds(series.low, start, end),
    high: averageFromBounds(series.high, start, end)
  };
}

function smoothSeries(values: number[], radius: number): number[] {
  const prefix = buildPrefixSums(values);
  return values.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length, index + radius + 1);
    return averageFromBounds(prefix, start, end);
  });
}

function inferStrongBeatTimes(frames: EnergyFrame[]): number[] {
  if (frames.length < 3) return [];
  const frameStep = resolveFrameStep(frames);
  const minimumGap = 0.3;
  const lookBack = Math.max(4, Math.round(0.6 / frameStep));
  const energyPrefix = buildPrefixSums(frames.map((frame) => frame.energy));
  const beats: number[] = [];
  let lastBeat = -Infinity;

  for (let index = lookBack; index < frames.length - 1; index += 1) {
    const frame = frames[index];
    const previous = frames[index - 1];
    const next = frames[index + 1];
    const localEnergy = averageFromBounds(energyPrefix, index - lookBack, index);
    if (
      frame.energy > previous.energy &&
      frame.energy >= next.energy &&
      frame.energy >= Math.max(0.14, localEnergy * 1.22) &&
      frame.time - lastBeat >= minimumGap
    ) {
      beats.push(frame.time);
      lastBeat = frame.time;
    }
  }

  return beats;
}

function snapToNearestTime(time: number, candidates: number[], tolerance: number): number {
  const index = lowerBoundNumber(candidates, time);
  const next = candidates[index];
  const previous = candidates[index - 1];
  let best = time;
  let bestDistance = tolerance;
  for (const candidate of [previous, next]) {
    if (candidate === undefined) continue;
    const distance = Math.abs(candidate - time);
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return Math.round(best * 1000) / 1000;
}

function resolveFrameStep(frames: EnergyFrame[]): number {
  return frames.length > 1 ? Math.max(0.001, frames[1].time - frames[0].time) : 0.25;
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

function averageFromBounds(prefix: number[], start: number, end: number): number {
  const count = Math.max(0, end - start);
  return count === 0 ? 0 : (prefix[end] - prefix[start]) / count;
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

function lowerBoundNumber(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid] < target) {
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

function normalizedStdFromPrefixes(
  valuePrefix: number[],
  squaredPrefix: number[],
  range: { start: number; end: number; count: number }
): number {
  if (range.count === 0) return 1;
  const avg = averageFromPrefix(valuePrefix, range);
  const squaredAverage = averageFromPrefix(squaredPrefix, range);
  const variance = Math.max(0, squaredAverage - avg * avg);
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
