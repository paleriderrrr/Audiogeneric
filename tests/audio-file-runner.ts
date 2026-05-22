import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeDecodedAudio } from '../src/audio/analyzer.js';
import type { AudioAnalysis, DecodedAudioBuffer } from '../src/audio/types.js';

export interface AudioFileExpectations {
  minBpm?: number;
  maxBpm?: number;
  minBeatCount?: number;
  minSegmentCount?: number;
}

export interface AudioFileTestResult {
  filePath: string;
  analysis: AudioAnalysis<DecodedAudioBuffer>;
  progressLog: string[];
}

export async function analyzeAudioFilePath(
  filePath: string
): Promise<AudioFileTestResult> {
  const absolutePath = resolve(filePath);
  const bytes = await readFile(absolutePath);
  const buffer = decodeWavFile(bytes);
  const progressLog: string[] = [];
  const analysis = analyzeDecodedAudio(buffer, (label, progress) => {
    progressLog.push(`${label}:${progress}`);
  });

  return {
    filePath: absolutePath,
    analysis,
    progressLog
  };
}

export function assertAudioAnalysisExpectations(
  result: AudioFileTestResult,
  expectations: AudioFileExpectations
): void {
  const { analysis } = result;

  if (expectations.minBpm !== undefined && analysis.bpm < expectations.minBpm) {
    throw new Error(`Expected bpm >= ${expectations.minBpm}, received ${analysis.bpm}`);
  }
  if (expectations.maxBpm !== undefined && analysis.bpm > expectations.maxBpm) {
    throw new Error(`Expected bpm <= ${expectations.maxBpm}, received ${analysis.bpm}`);
  }
  if (expectations.minBeatCount !== undefined && analysis.beats.length < expectations.minBeatCount) {
    throw new Error(`Expected beat count >= ${expectations.minBeatCount}, received ${analysis.beats.length}`);
  }
  if (expectations.minSegmentCount !== undefined && analysis.segments.length < expectations.minSegmentCount) {
    throw new Error(`Expected segment count >= ${expectations.minSegmentCount}, received ${analysis.segments.length}`);
  }

  if (analysis.tempoCandidates.length === 0) {
    throw new Error('Expected at least one tempo candidate');
  }
  if (!(analysis.warmupWindow.end > analysis.warmupWindow.start)) {
    throw new Error('Expected warmup window end to be after start');
  }
  if (analysis.warmupWindow.start < 0 || analysis.warmupWindow.end > analysis.duration) {
    throw new Error('Expected warmup window to stay inside the audio duration');
  }
}

export function decodeWavFile(bytes: Uint8Array): DecodedAudioBuffer {
  if (bytes.byteLength < 44) {
    throw new Error('WAV file is too short to decode');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('Only RIFF/WAVE files are supported by the audio file test runner');
  }

  let format: { audioFormat: number; numberOfChannels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let dataOffset = -1;
  let dataSize = 0;
  let offset = 12;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkId === 'fmt ') {
      format = {
        audioFormat: view.getUint16(chunkDataOffset, true),
        numberOfChannels: view.getUint16(chunkDataOffset + 2, true),
        sampleRate: view.getUint32(chunkDataOffset + 4, true),
        bitsPerSample: view.getUint16(chunkDataOffset + 14, true)
      };
    } else if (chunkId === 'data') {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!format) {
    throw new Error('WAV file is missing the fmt chunk');
  }
  if (dataOffset < 0 || dataSize <= 0) {
    throw new Error('WAV file is missing audio sample data');
  }

  const { audioFormat, numberOfChannels, sampleRate, bitsPerSample } = format;
  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(`Unsupported WAV encoding: ${audioFormat}`);
  }
  if (bitsPerSample !== 16 && !(audioFormat === 3 && bitsPerSample === 32)) {
    throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}`);
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(dataSize / (numberOfChannels * bytesPerSample));
  const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(frameCount));

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      const sampleOffset = dataOffset + ((frame * numberOfChannels) + channel) * bytesPerSample;
      const value = audioFormat === 1
        ? view.getInt16(sampleOffset, true) / 32768
        : view.getFloat32(sampleOffset, true);
      channels[channel][frame] = Math.max(-1, Math.min(1, value));
    }
  }

  return {
    length: frameCount,
    duration: frameCount / sampleRate,
    sampleRate,
    numberOfChannels,
    getChannelData(channel: number) {
      const data = channels[channel];
      if (!data) {
        throw new Error(`Missing channel ${channel}`);
      }
      return data;
    }
  };
}

function readAscii(view: DataView, offset: number, length: number): string {
  return Array.from({ length }, (_, index) => String.fromCharCode(view.getUint8(offset + index))).join('');
}
