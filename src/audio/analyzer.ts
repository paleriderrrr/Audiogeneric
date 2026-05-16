import { analyzeDecodedAudio } from './analysis-core.js';
import type { AudioAnalysis } from './types.js';

export type { AudioAnalysis, BeatPoint, MusicSegment, TempoCandidate, WarmupWindow, CalibrationResult } from './types.js';
export { analyzeDecodedAudio } from './analysis-core.js';

export async function analyzeAudioFile(
  file: File,
  onProgress: (label: string, value: number) => void
): Promise<AudioAnalysis<AudioBuffer>> {
  const context = new AudioContext();
  try {
    onProgress('Reading audio file', 10);
    const bytes = await file.arrayBuffer();

    onProgress('Decoding audio', 30);
    const buffer = await context.decodeAudioData(bytes.slice(0));
    return analyzeDecodedAudio(buffer, onProgress);
  } finally {
    await context.close().catch(() => {
      // ignore close errors while unwinding failed analysis
    });
  }
}
