import { buildTempoCandidates, selectWarmupWindow, summarizeSegmentEnergies, type EnergyFrame } from './pipeline.js';
import type { AudioAnalysis, BeatPoint, DecodedAudioBuffer } from './types.js';

export function analyzeDecodedAudio<TBuffer extends DecodedAudioBuffer>(
  buffer: TBuffer,
  onProgress: (label: string, value: number) => void
): AudioAnalysis<TBuffer> {
  const mono = mixToMono(buffer);

  onProgress('Detecting beats', 55);
  const frames = buildEnergyFrames(mono, buffer.sampleRate);
  const beats = detectBeats(frames);
  if (beats.length < 4) {
    throw new Error('Could not detect enough clear beats. Try another track with a stronger pulse.');
  }

  onProgress('Mapping song structure', 80);
  const tempoCandidates = buildTempoCandidates(beats.map((beat) => beat.time));
  const bpm = tempoCandidates[0]?.bpm ?? 120;
  const firstBeat = beats[0].time % (60 / bpm);
  const summarizedSegments = summarizeSegmentEnergies(frames, buffer.duration);
  const segments = summarizedSegments.map((segment) => ({
    start: segment.start,
    end: segment.end,
    label: segment.label,
    energy: segment.energy
  }));
  const warmupWindow = selectWarmupWindow(summarizedSegments, frames, 12);

  onProgress('Ready', 100);
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

function mixToMono(buffer: DecodedAudioBuffer): Float32Array {
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
    throw new Error('The audio energy is too low to build a battle from this file.');
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
  const minimumBeatGap = 0.3;
  let lastBeatTime = -Infinity;
  let rollingEnergy = 0;

  for (let index = 0; index < lookBack && index < frames.length; index += 1) {
    rollingEnergy += frames[index].energy;
  }

  for (let index = lookBack; index < frames.length - 1; index += 1) {
    const frame = frames[index];
    const average = rollingEnergy / lookBack;
    const isPeak = frame.energy > frames[index - 1].energy && frame.energy >= frames[index + 1].energy;
    const isStrong = frame.energy > Math.max(average * 1.35, 0.16);
    const separated = frame.time - lastBeatTime >= minimumBeatGap;

    if (isPeak && isStrong && separated) {
      beats.push({ time: frame.time, strength: frame.energy });
      lastBeatTime = frame.time;
    } else if (isPeak && isStrong && beats.length > 0 && frame.time - lastBeatTime < minimumBeatGap) {
      const previousBeat = beats[beats.length - 1];
      if (frame.energy > previousBeat.strength) {
        previousBeat.time = frame.time;
        previousBeat.strength = frame.energy;
        lastBeatTime = frame.time;
      }
    }

    rollingEnergy += frame.energy - frames[index - lookBack].energy;
  }

  return beats;
}
