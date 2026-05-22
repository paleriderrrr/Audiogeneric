import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeAudioFilePath, assertAudioAnalysisExpectations } from './audio-file-runner.js';

test('analyzes a local wav file path through the existing audio pipeline', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'audiogenic-audio-test-'));
  const filePath = join(tempDir, 'pulse.wav');

  try {
    await writeFile(filePath, createPulseWavBytes({
      bpm: 120,
      durationSeconds: 12,
      sampleRate: 44100
    }));

    const result = await analyzeAudioFilePath(filePath);
    assertAudioAnalysisExpectations(result, {
      minBpm: 100,
      maxBpm: 140,
      minBeatCount: 8,
      minSegmentCount: 3
    });

    assert.equal(result.analysis.duration >= 11.5, true);
    assert.equal(result.progressLog.length > 0, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function createPulseWavBytes(input: {
  bpm: number;
  durationSeconds: number;
  sampleRate: number;
}): Uint8Array {
  const channelCount = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const frameCount = input.durationSeconds * input.sampleRate;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = input.sampleRate * blockAlign;
  const dataSize = frameCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const samples = new Int16Array(buffer, 44, frameCount);
  const beatInterval = 60 / input.bpm;
  const pulseLength = Math.floor(input.sampleRate * 0.06);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, input.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / input.sampleRate;
    const beatPhase = time % beatInterval;
    const inPulse = beatPhase < pulseLength / input.sampleRate;
    const envelope = inPulse ? 1 - (beatPhase / (pulseLength / input.sampleRate)) : 0;
    const tone = Math.sin(2 * Math.PI * 110 * time) * envelope;
    const harmonic = Math.sin(2 * Math.PI * 220 * time) * envelope * 0.4;
    samples[frame] = Math.round((tone + harmonic) * 0.85 * 32767);
  }

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}
