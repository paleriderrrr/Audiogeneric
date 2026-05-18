import type { BeatPoint, MusicSegment, SegmentFeature, SegmentIntensityRole, TempoCandidate, TrackStyleProfile, WarmupWindow } from './types.js';

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

export function inferTrackStyleProfile(input: {
  bpm: number;
  beats: BeatPoint[];
  frames: EnergyFrame[];
  segments: SegmentEnergySummary[];
}): TrackStyleProfile {
  const energyMean = average(input.frames.map((frame) => frame.energy));
  const lowFreqWeight = average(input.frames.map((frame) => frame.low));
  const highFreqWeight = average(input.frames.map((frame) => frame.high));
  const energies = input.frames.map((frame) => frame.energy);
  const dynamicRange = Math.max(...energies, 0) - Math.min(...energies, 0);
  const beatDensity = input.beats.length / Math.max(1, input.segments[input.segments.length - 1]?.end ?? input.frames[input.frames.length - 1]?.time ?? 1);
  const normalizedBeatDensity = clamp(beatDensity / 2.5, 0, 1);
  const segmentContrast = Math.max(...input.segments.map((segment) => segment.energy), 0) - Math.min(...input.segments.map((segment) => segment.energy), 0);
  const descriptors: string[] = [];

  if (normalizedBeatDensity > 0.8 && highFreqWeight > lowFreqWeight * 1.35) descriptors.push('short-fast-pulses');
  if (dynamicRange > 0.35 && lowFreqWeight >= highFreqWeight * 1.2) descriptors.push('wide-impact-hits');
  if (lowFreqWeight > 0.7 && input.bpm < 115) descriptors.push('heavy-low-end');
  if (energyMean < 0.28 && normalizedBeatDensity < 0.35) descriptors.push('slow-atmospheric');

  if (input.bpm >= 132 && normalizedBeatDensity > 0.7 && highFreqWeight > lowFreqWeight * 1.2) {
    return styleProfile('electronic', 0.88, energyMean, lowFreqWeight, highFreqWeight, dynamicRange, normalizedBeatDensity, segmentContrast, descriptors);
  }
  if (dynamicRange > 0.35 && lowFreqWeight >= highFreqWeight * 1.15 && input.bpm >= 90 && input.bpm <= 150) {
    return styleProfile('rock', 0.82, energyMean, lowFreqWeight, highFreqWeight, dynamicRange, normalizedBeatDensity, segmentContrast, descriptors);
  }
  if (lowFreqWeight > highFreqWeight * 1.45 && input.bpm < 115) {
    return styleProfile('hiphop', 0.72, energyMean, lowFreqWeight, highFreqWeight, dynamicRange, normalizedBeatDensity, segmentContrast, descriptors);
  }
  if (energyMean < 0.32 && normalizedBeatDensity < 0.45) {
    return styleProfile('ambient', 0.78, energyMean, lowFreqWeight, highFreqWeight, dynamicRange, normalizedBeatDensity, segmentContrast, descriptors);
  }
  if (dynamicRange > 0.45 && highFreqWeight >= lowFreqWeight * 0.9) {
    return styleProfile('orchestral', 0.62, energyMean, lowFreqWeight, highFreqWeight, dynamicRange, normalizedBeatDensity, segmentContrast, descriptors);
  }
  return styleProfile('pop', 0.55, energyMean, lowFreqWeight, highFreqWeight, dynamicRange, normalizedBeatDensity, segmentContrast, descriptors);
}

export function buildSegmentFeatures(segments: SegmentEnergySummary[], style: TrackStyleProfile): SegmentFeature[] {
  return segments.map((segment, index) => {
    const isLast = index === segments.length - 1;
    const intensityRole = selectIntensityRole(segment, isLast);
    return {
      start: segment.start,
      end: segment.end,
      label: segment.label,
      energy: segment.energy,
      beatDensity: segment.beatDensity,
      lowFreqWeight: segment.lowFreqWeight,
      highFreqWeight: segment.highFreqWeight,
      stability: segment.stability,
      intensityRole,
      recommendedAttack: selectRecommendedAttack(segment, style, intensityRole)
    };
  });
}

export function selectWarmupWindow(
  segments: SegmentEnergySummary[],
  frames: EnergyFrame[],
  targetDuration: number
): WarmupWindow {
  const frameStep = frames.length > 1 ? Math.max(0.25, frames[1].time - frames[0].time) : 0.25;
  const audioEnd = segments[segments.length - 1]?.end ?? (frames.length > 0 ? frames[frames.length - 1].time + frameStep : targetDuration);
  const searchEnd = Math.max(0, audioEnd - targetDuration);
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

  const end = Math.min(audioEnd, bestStart + targetDuration);

  return {
    start: bestStart,
    end,
    reason: bestScore > 0.65 ? 'high-clarity-beat' : 'high-energy-stable-section'
  };
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function styleProfile(
  primaryStyle: TrackStyleProfile['primaryStyle'],
  confidence: number,
  energyMean: number,
  lowFreqWeight: number,
  highFreqWeight: number,
  dynamicRange: number,
  beatDensity: number,
  segmentContrast: number,
  descriptors: string[]
): TrackStyleProfile {
  return {
    primaryStyle,
    confidence,
    energyMean: round(energyMean),
    lowFreqWeight: round(lowFreqWeight),
    highFreqWeight: round(highFreqWeight),
    dynamicRange: round(dynamicRange),
    beatDensity: round(beatDensity),
    segmentContrast: round(segmentContrast),
    descriptors: [...new Set(descriptors)]
  };
}

function selectIntensityRole(segment: SegmentEnergySummary, isLast: boolean): SegmentIntensityRole {
  if (isLast && segment.energy < 0.45) return 'release';
  if (segment.energy >= 0.85) return 'climax';
  if (segment.energy >= 0.65) return 'peak';
  if (segment.energy >= 0.35) return 'groove';
  return 'setup';
}

function selectRecommendedAttack(
  segment: SegmentEnergySummary,
  style: TrackStyleProfile,
  role: SegmentIntensityRole
): SegmentFeature['recommendedAttack'] {
  if (role === 'setup' || role === 'release') return segment.energy < 0.22 ? 'none' : 'sparse-ring';
  if (style.primaryStyle === 'electronic') return segment.beatDensity > 0.75 ? 'lane-burst' : 'aimed-burst';
  if (style.primaryStyle === 'rock') return role === 'climax' || role === 'peak' ? 'screen-ring' : 'sparse-ring';
  if (style.primaryStyle === 'hiphop') return segment.lowFreqWeight > segment.highFreqWeight ? 'aimed-burst' : 'lane-burst';
  if (style.primaryStyle === 'ambient') return 'sparse-ring';
  return role === 'climax' ? 'screen-ring' : 'aimed-burst';
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
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
