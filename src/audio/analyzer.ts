import { buildTempoCandidates, selectWarmupWindow, summarizeSegmentEnergies, type EnergyFrame } from './pipeline.js';
import type { AudioAnalysis, BeatPoint } from './types.js';

export type { AudioAnalysis, BeatPoint, MusicSegment, TempoCandidate, WarmupWindow, CalibrationResult } from './types.js';

export async function analyzeAudioFile(
  file: File,
  onProgress: (label: string, value: number) => void
): Promise<AudioAnalysis> {
  onProgress('读取音频文件', 10);
  const context = new AudioContext();
  const bytes = await file.arrayBuffer();

  onProgress('解码音频', 30);
  const buffer = await context.decodeAudioData(bytes.slice(0));
  const mono = mixToMono(buffer);

  onProgress('检测节拍', 55);
  const frames = buildEnergyFrames(mono, buffer.sampleRate);
  const beats = detectBeats(frames);
  if (beats.length < 4) {
    await context.close();
    throw new Error('未检测到足够清晰的节拍，换一首节奏更明确的歌曲再试。');
  }

  onProgress('分析结构', 80);
  const tempoCandidates = buildTempoCandidates(beats.map((beat) => beat.time));
  const bpm = tempoCandidates[0]?.bpm ?? 120;
  const firstBeat = beats[0].time % (60 / bpm);
  const segments = summarizeSegmentEnergies(frames, buffer.duration).map((segment) => ({
    start: segment.start,
    end: segment.end,
    label: segment.label,
    energy: segment.energy
  }));
  const warmupWindow = selectWarmupWindow(summarizeSegmentEnergies(frames, buffer.duration), frames, 8);

  onProgress('完成', 100);
  await context.close();
  return {
    buffer,
    bpm,
    firstBeat,
    duration: buffer.duration,
    beats,
    segments,
    tempoCandidates,
    warmupWindow,
    calibration: null
  };
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const channel = buffer.getChannelData(channelIndex);
    for (let sample = 0; sample < channel.length; sample += 1) {
      mono[sample] += channel[sample] / buffer.numberOfChannels;
    }
  }
  return mono;
}

function buildEnergyFrames(samples: Float32Array, sampleRate: number): EnergyFrame[] {
  const frameSize = Math.max(256, Math.floor(sampleRate * 0.05));
  const frames: EnergyFrame[] = [];
  let maxEnergy = 0;

  for (let offset = 0; offset + frameSize < samples.length; offset += frameSize) {
    let sum = 0;
    let low = 0;
    let high = 0;
    for (let index = 0; index < frameSize; index += 1) {
      const sample = samples[offset + index];
      const power = sample * sample;
      sum += power;
      if (index < frameSize / 4) low += power;
      if (index > frameSize / 2) high += power;
    }
    const energy = Math.sqrt(sum / frameSize);
    maxEnergy = Math.max(maxEnergy, energy);
    frames.push({
      time: offset / sampleRate,
      energy,
      low: Math.sqrt(low / frameSize),
      high: Math.sqrt(high / frameSize)
    });
  }

  if (maxEnergy <= 0) {
    throw new Error('音频能量为零，无法生成关卡。');
  }

  return frames.map((frame) => ({
    ...frame,
    energy: frame.energy / maxEnergy,
    low: frame.low / maxEnergy,
    high: frame.high / maxEnergy
  }));
}

function detectBeats(frames: EnergyFrame[]): BeatPoint[] {
  const beats: BeatPoint[] = [];
  const lookBack = 12;
  let lastBeatTime = -Infinity;

  for (let index = lookBack; index < frames.length - 1; index += 1) {
    const frame = frames[index];
    const recent = frames.slice(index - lookBack, index);
    const average = recent.reduce((sum, item) => sum + item.energy, 0) / recent.length;
    const isPeak = frame.energy > frames[index - 1].energy && frame.energy >= frames[index + 1].energy;
    const isStrong = frame.energy > Math.max(average * 1.35, 0.16);
    const separated = frame.time - lastBeatTime >= 0.25;

    if (isPeak && isStrong && separated) {
      beats.push({ time: frame.time, strength: frame.energy });
      lastBeatTime = frame.time;
    }
  }

  return beats;
}
