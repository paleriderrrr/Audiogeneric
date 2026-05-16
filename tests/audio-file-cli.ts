import { analyzeAudioFilePath, assertAudioAnalysisExpectations, type AudioFileExpectations } from './audio-file-runner.js';

async function main(): Promise<void> {
  const [, , filePath, expectationJson] = process.argv;
  if (!filePath) {
    throw new Error('Usage: node dist-test/tests/audio-file-cli.js <audio-file-path> [expectations-json]');
  }

  const expectations: AudioFileExpectations = expectationJson ? JSON.parse(expectationJson) as AudioFileExpectations : {
    minBpm: 60,
    maxBpm: 180,
    minBeatCount: 4,
    minSegmentCount: 3
  };

  const result = await analyzeAudioFilePath(filePath);
  assertAudioAnalysisExpectations(result, expectations);

  const { analysis } = result;
  process.stdout.write(JSON.stringify({
    filePath: result.filePath,
    bpm: analysis.bpm,
    beatCount: analysis.beats.length,
    segmentCount: analysis.segments.length,
    warmupWindow: analysis.warmupWindow,
    tempoCandidates: analysis.tempoCandidates.slice(0, 3),
    progressLog: result.progressLog
  }, null, 2));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
