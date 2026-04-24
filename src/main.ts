import './styles.css';
import { analyzeAudioFile } from './audio/analyzer.js';
import { calibrateWarmupTaps } from './audio/pipeline.js';
import type { AudioAnalysis } from './audio/types.js';
import { GameRuntime } from './game/runtime.js';
import { runWithDisplayedError } from './ui/task.js';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app container.');

app.innerHTML = `
  <main class="shell">
    <section class="panel">
      <h1>AUDIOGENIC</h1>
      <p>Drop a local audio file to generate a level. Move with WASD, attack with left click, block with F, and dash with Space.</p>
      <label class="difficulty">
        <span>Difficulty</span>
        <input id="difficulty" type="range" min="0.3" max="2" step="0.1" value="1" />
        <output id="difficultyValue">1.0x</output>
      </label>
      <label id="dropZone" class="drop-zone">
        <input id="fileInput" type="file" accept="audio/*" />
        <strong>Select or drop MP3 / WAV / OGG / FLAC</strong>
      </label>
      <button id="warmupTap" class="warmup-tap" hidden>Tap along with the beat</button>
      <div id="status" class="status">Waiting for audio</div>
      <div id="result" class="result" hidden></div>
    </section>
    <canvas id="gameCanvas" tabindex="0"></canvas>
  </main>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#gameCanvas');
const fileInput = document.querySelector<HTMLInputElement>('#fileInput');
const dropZone = document.querySelector<HTMLLabelElement>('#dropZone');
const statusEl = document.querySelector<HTMLDivElement>('#status');
const resultEl = document.querySelector<HTMLDivElement>('#result');
const difficultyInput = document.querySelector<HTMLInputElement>('#difficulty');
const difficultyValue = document.querySelector<HTMLOutputElement>('#difficultyValue');
const warmupTapButton = document.querySelector<HTMLButtonElement>('#warmupTap');

if (!canvas || !fileInput || !dropZone || !statusEl || !resultEl || !difficultyInput || !difficultyValue || !warmupTapButton) {
  throw new Error('Page controls failed to initialize.');
}

const gameCanvas = canvas;
const audioInput = fileInput;
const audioDropZone = dropZone;
const statusView = statusEl;
const resultView = resultEl;
const difficultySlider = difficultyInput;
const difficultyOutput = difficultyValue;
const warmupButton = warmupTapButton;

const runtime = new GameRuntime(gameCanvas, {
  onStatus(message) {
    statusView.textContent = message;
  },
  onResult(message) {
    resultView.hidden = false;
    resultView.textContent = message;
  }
});

window.addEventListener('resize', () => runtime.resize());
runtime.resize();

difficultySlider.addEventListener('input', () => {
  difficultyOutput.value = `${Number(difficultySlider.value).toFixed(1)}x`;
});

audioInput.addEventListener('change', () => {
  const file = audioInput.files?.[0];
  if (file) {
    void runWithDisplayedError(() => loadAndStart(file), (message) => {
      statusView.textContent = message;
    });
  }
});

audioDropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  audioDropZone.classList.add('dragging');
});

audioDropZone.addEventListener('dragleave', () => {
  audioDropZone.classList.remove('dragging');
});

audioDropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  audioDropZone.classList.remove('dragging');
  const file = event.dataTransfer?.files[0];
  if (file) {
    void runWithDisplayedError(() => loadAndStart(file), (message) => {
      statusView.textContent = message;
    });
  }
});

async function loadAndStart(file: File): Promise<void> {
  if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|flac|m4a)$/i.test(file.name)) {
    throw new Error('Please choose an audio file.');
  }

  resultView.hidden = true;
  statusView.textContent = 'Preparing analysis';
  const analysis = await analyzeAudioFile(file, (label, progress) => {
    statusView.textContent = `${label} ${progress}%`;
  });
  statusView.textContent = 'Entering warmup';
  const calibratedAnalysis = await runHiddenWarmup(analysis);
  statusView.textContent = 'Starting battle';
  await runtime.start(calibratedAnalysis, Number(difficultySlider.value));
  gameCanvas.focus();
}

async function runHiddenWarmup(analysis: AudioAnalysis): Promise<AudioAnalysis> {
  const maxAttempts = 2;
  const previewDuration = Math.min(8, analysis.warmupWindow.end - analysis.warmupWindow.start);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    statusView.textContent = attempt === 1
      ? 'Tap with the beat to lock into the track'
      : 'Try once more and settle into the groove';
    const taps = await collectWarmupTaps(analysis, previewDuration);
    const calibration = calibrateWarmupTaps({
      taps,
      warmupStart: analysis.warmupWindow.start,
      tempoCandidates: analysis.tempoCandidates,
      suggestedDownbeat: analysis.firstBeat
    });

    if (calibration.confirmed || attempt === maxAttempts) {
      analysis.calibration = calibration;
      analysis.bpm = calibration.selectedBpm || analysis.bpm;
      analysis.firstBeat = calibration.selectedDownbeat;
      return analysis;
    }
  }

  return analysis;
}

function collectWarmupTaps(analysis: AudioAnalysis, previewDuration: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const context = new AudioContext();
    const source = context.createBufferSource();
    source.buffer = analysis.buffer;
    source.connect(context.destination);

    const taps: number[] = [];
    let startedAt = 0;
    let settled = false;

    const finish = async () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        await context.close();
      } catch {
        // ignore close errors
      }
      resolve(taps);
    };

    const cleanup = () => {
      warmupButton.hidden = true;
      warmupButton.classList.remove('listening');
      warmupButton.removeEventListener('click', handleTap);
      window.removeEventListener('keydown', handleKeydown);
    };

    const handleTap = () => {
      if (!startedAt) return;
      const songTime = analysis.warmupWindow.start + (context.currentTime - startedAt);
      taps.push(songTime);
      warmupButton.classList.add('listening');
      warmupButton.textContent = taps.length >= 4 ? 'Keep going, you are locked in' : 'Keep tapping';
      setTimeout(() => warmupButton.classList.remove('listening'), 120);
      if (taps.length >= 6) {
        void finish();
      }
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
        handleTap();
      }
    };

    warmupButton.hidden = false;
    warmupButton.textContent = 'Tap along with the beat';
    warmupButton.addEventListener('click', handleTap);
    window.addEventListener('keydown', handleKeydown);

    context.resume()
      .then(() => {
        startedAt = context.currentTime;
        source.start(0, analysis.warmupWindow.start, previewDuration);
        source.onended = () => {
          void finish();
        };
      })
      .catch(async (error) => {
        cleanup();
        try {
          await context.close();
        } catch {
          // ignore close errors
        }
        reject(error);
      });
  });
}
