import { buildTempoCandidates, selectWarmupWindow, summarizeSegmentEnergies, type EnergyFrame } from './pipeline.js';
import { extractMusicPrimitives } from './primitives.js';
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
  const summarizedSegments = summarizeSegmentEnergies(frames, buffer.duration, beats.map((beat) => beat.time));
  const segments = summarizedSegments.map((segment) => ({
    start: segment.start,
    end: segment.end,
    label: segment.label,
    energy: segment.energy,
    lowFreqWeight: segment.lowFreqWeight,
    highFreqWeight: segment.highFreqWeight,
    stability: segment.stability,
    spectralCentroid: segment.spectralCentroid,
    spectralFlux: segment.spectralFlux,
    beatDensity: segment.beatDensity,
    intensity: segment.intensity
  }));
  const warmupWindow = selectWarmupWindow(summarizedSegments, frames, 12);
  const primitives = extractMusicPrimitives(summarizedSegments);

  onProgress('Ready', 100);
  return {
    buffer,
    bpm,
    firstBeat,
    duration: buffer.duration,
    beats,
    segments,
    primitives,
    tempoCandidates,
    warmupWindow,
    calibration: null
  };
}

function mixToMono(buffer: DecodedAudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  let monoEnergy = 0;
  let strongestChannel: Float32Array | null = null;
  let strongestChannelEnergy = 0;

  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const channel = buffer.getChannelData(channelIndex);
    let channelEnergy = 0;
    for (let sample = 0; sample < channel.length; sample += 1) {
      const value = channel[sample];
      mono[sample] += value / buffer.numberOfChannels;
      channelEnergy += value * value;
    }
    if (channelEnergy > strongestChannelEnergy) {
      strongestChannel = channel;
      strongestChannelEnergy = channelEnergy;
    }
  }

  for (const value of mono) {
    monoEnergy += value * value;
  }

  if (strongestChannel && strongestChannelEnergy > 0 && monoEnergy / strongestChannelEnergy < 0.05) {
    return strongestChannel.slice(0, buffer.length);
  }

  return mono;
}

export function buildEnergyFrames(samples: Float32Array, sampleRate: number): EnergyFrame[] {
  const frameSize = nextPowerOfTwo(Math.max(1024, Math.floor(sampleRate * 0.046)));
  const hopSize = Math.max(256, Math.floor(frameSize / 2));
  const window = createHannWindow(frameSize);
  const bitReversal = createBitReversalTable(frameSize);
  const frames: EnergyFrame[] = [];
  let maxEnergy = 0;
  let maxSpectralFlux = 0;
  let previousMagnitudes: Float64Array | null = null;

  for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
    let sum = 0;
    const real = new Float64Array(frameSize);
    const imag = new Float64Array(frameSize);

    for (let index = 0; index < frameSize; index += 1) {
      const sample = samples[offset + index] * window[index];
      real[index] = sample;
      const power = sample * sample;
      sum += power;
    }

    fft(real, imag, bitReversal);
    const magnitudes = buildMagnitudeSpectrum(real, imag);
    const energy = Math.sqrt(sum / frameSize);
    const low = bandEnergyRatio(real, imag, sampleRate, 40, 250);
    const high = bandEnergyRatio(real, imag, sampleRate, 2000, 8000);
    const spectralCentroid = spectralCentroidRatio(magnitudes, sampleRate);
    const spectralFlux = previousMagnitudes ? positiveSpectralFlux(magnitudes, previousMagnitudes) : 0;
    previousMagnitudes = magnitudes;
    maxEnergy = Math.max(maxEnergy, energy);
    maxSpectralFlux = Math.max(maxSpectralFlux, spectralFlux);
    frames.push({
      time: (offset + frameSize / 2) / sampleRate,
      energy,
      low,
      high,
      spectralCentroid,
      spectralFlux
    });
  }

  if (maxEnergy <= 0) {
    throw new Error('The audio energy is too low to build a battle from this file.');
  }

  return frames.map((frame) => ({
    ...frame,
    energy: frame.energy / maxEnergy,
    low: frame.low,
    high: frame.high,
    spectralCentroid: frame.spectralCentroid ?? 0,
    spectralFlux: maxSpectralFlux > 0 ? (frame.spectralFlux ?? 0) / maxSpectralFlux : 0
  }));
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function createHannWindow(size: number): Float64Array {
  const window = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((Math.PI * 2 * index) / (size - 1)));
  }
  return window;
}

function createBitReversalTable(size: number): Uint32Array {
  const bits = Math.log2(size);
  const table = new Uint32Array(size);
  for (let index = 0; index < size; index += 1) {
    let reversed = 0;
    for (let bit = 0; bit < bits; bit += 1) {
      reversed = (reversed << 1) | ((index >> bit) & 1);
    }
    table[index] = reversed;
  }
  return table;
}

function fft(real: Float64Array, imag: Float64Array, bitReversal: Uint32Array): void {
  const size = real.length;
  for (let index = 0; index < size; index += 1) {
    const reversed = bitReversal[index];
    if (reversed > index) {
      const realValue = real[index];
      const imagValue = imag[index];
      real[index] = real[reversed];
      imag[index] = imag[reversed];
      real[reversed] = realValue;
      imag[reversed] = imagValue;
    }
  }

  for (let length = 2; length <= size; length *= 2) {
    const halfLength = length / 2;
    const angleStep = (-Math.PI * 2) / length;
    const stepCos = Math.cos(angleStep);
    const stepSin = Math.sin(angleStep);

    for (let start = 0; start < size; start += length) {
      let twiddleReal = 1;
      let twiddleImag = 0;
      for (let offset = 0; offset < halfLength; offset += 1) {
        const evenIndex = start + offset;
        const oddIndex = evenIndex + halfLength;
        const oddReal = real[oddIndex] * twiddleReal - imag[oddIndex] * twiddleImag;
        const oddImag = real[oddIndex] * twiddleImag + imag[oddIndex] * twiddleReal;

        real[oddIndex] = real[evenIndex] - oddReal;
        imag[oddIndex] = imag[evenIndex] - oddImag;
        real[evenIndex] += oddReal;
        imag[evenIndex] += oddImag;

        const nextReal = twiddleReal * stepCos - twiddleImag * stepSin;
        twiddleImag = twiddleReal * stepSin + twiddleImag * stepCos;
        twiddleReal = nextReal;
      }
    }
  }
}

function bandEnergyRatio(
  real: Float64Array,
  imag: Float64Array,
  sampleRate: number,
  minHz: number,
  maxHz: number
): number {
  const nyquistBin = real.length / 2;
  const startBin = Math.max(1, Math.floor((minHz * real.length) / sampleRate));
  const endBin = Math.min(nyquistBin, Math.ceil((maxHz * real.length) / sampleRate));
  let bandPower = 0;
  let totalPower = 0;

  for (let bin = 1; bin <= nyquistBin; bin += 1) {
    const power = real[bin] * real[bin] + imag[bin] * imag[bin];
    totalPower += power;
    if (bin >= startBin && bin <= endBin) {
      bandPower += power;
    }
  }

  return totalPower <= 0 ? 0 : bandPower / totalPower;
}

function buildMagnitudeSpectrum(real: Float64Array, imag: Float64Array): Float64Array {
  const nyquistBin = real.length / 2;
  const magnitudes = new Float64Array(nyquistBin + 1);
  for (let bin = 1; bin <= nyquistBin; bin += 1) {
    magnitudes[bin] = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]);
  }
  return magnitudes;
}

function spectralCentroidRatio(magnitudes: Float64Array, sampleRate: number): number {
  let weightedFrequency = 0;
  let magnitudeSum = 0;
  const fftSize = (magnitudes.length - 1) * 2;
  const nyquist = sampleRate / 2;

  for (let bin = 1; bin < magnitudes.length; bin += 1) {
    const magnitude = magnitudes[bin];
    const frequency = (bin * sampleRate) / fftSize;
    weightedFrequency += frequency * magnitude;
    magnitudeSum += magnitude;
  }

  return magnitudeSum <= 0 ? 0 : Math.min(1, weightedFrequency / magnitudeSum / nyquist);
}

function positiveSpectralFlux(current: Float64Array, previous: Float64Array): number {
  const length = Math.min(current.length, previous.length);
  let positiveDelta = 0;
  let totalMagnitude = 0;
  for (let index = 1; index < length; index += 1) {
    const diff = current[index] - previous[index];
    if (diff > 0) positiveDelta += diff;
    totalMagnitude += current[index];
  }
  return totalMagnitude <= 0 ? 0 : positiveDelta / totalMagnitude;
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
