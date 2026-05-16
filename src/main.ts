import './styles.css';
import { analyzeAudioFile } from './audio/analyzer.js';
import { calibrateWarmupTaps } from './audio/pipeline.js';
import type { AudioAnalysis } from './audio/types.js';
import type { LlmBehaviorProvider } from './behavior/factory.js';
import { GameRuntime, type RuntimeBehaviorMode } from './game/runtime.js';
import { createResultMarkup, createStatusMarkup, type StatusPhase } from './ui/status-presenter.js';
import { runWithDisplayedError } from './ui/task.js';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app container.');

const logoUrl = new URL('./assets/audiogenic-logo-white-v2.png', import.meta.url).href;
const REQUIRED_WARMUP_TAPS = 10;
const MIN_WARMUP_TAP_INTERVAL_SECONDS = 0.12;

app.innerHTML = `
  <main class="shell" data-stage="prepare">
    <section class="panel" aria-label="游戏控制台">
      <header class="panel-header">
        <span class="panel-kicker">音频驱动战术战斗</span>
        <img class="game-logo" src="${logoUrl}" alt="AUDIOgenic" />
      </header>
      <div class="system-strip" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>

      <section class="stage-card">
        <div class="stage-title">
          <span>准备阶段</span>
          <strong>导入音频并校准节拍</strong>
        </div>
        <label id="dropZone" class="drop-zone">
          <input id="fileInput" type="file" accept="audio/*" />
          <span class="drop-action">导入音频</span>
          <strong id="fileMeta">MP3 / WAV / OGG / FLAC</strong>
        </label>
      </section>

      <section class="stage-card">
        <div class="stage-title">
          <span>战斗设置</span>
          <strong>开始前选择行为模式</strong>
        </div>
        <fieldset class="mode-switch">
          <legend>行为生成</legend>
          <label class="mode-option">
            <input type="radio" name="behaviorMode" value="rules" checked />
            <span>规则模式</span>
          </label>
          <label class="mode-option">
            <input type="radio" name="behaviorMode" value="llm-preferred" />
            <span>大模型模式</span>
          </label>
        </fieldset>
        <p id="modeNote" class="mode-note">规则模式：使用本地节奏规则生成敌人行动，稳定且响应最快。</p>
        <label class="difficulty">
          <span>威胁</span>
          <input id="difficulty" type="range" min="0.3" max="2" step="0.1" value="1" />
          <output id="difficultyValue">1.0x</output>
        </label>
        <button id="startBattle" class="start-battle" disabled>开始战斗</button>
      </section>

      <button id="warmupTap" class="warmup-tap" hidden>同步点击</button>
      <div id="status" class="status"></div>
      <div id="result" class="result" hidden></div>
    </section>
    <canvas id="gameCanvas" tabindex="0" aria-label="战斗画面"></canvas>
  </main>
`;

const shell = document.querySelector<HTMLElement>('.shell');
const canvas = document.querySelector<HTMLCanvasElement>('#gameCanvas');
const fileInput = document.querySelector<HTMLInputElement>('#fileInput');
const dropZone = document.querySelector<HTMLLabelElement>('#dropZone');
const statusEl = document.querySelector<HTMLDivElement>('#status');
const resultEl = document.querySelector<HTMLDivElement>('#result');
const difficultyInput = document.querySelector<HTMLInputElement>('#difficulty');
const difficultyValue = document.querySelector<HTMLOutputElement>('#difficultyValue');
const warmupTapButton = document.querySelector<HTMLButtonElement>('#warmupTap');
const fileMetaEl = document.querySelector<HTMLElement>('#fileMeta');
const startBattleButton = document.querySelector<HTMLButtonElement>('#startBattle');
const modeNote = document.querySelector<HTMLParagraphElement>('#modeNote');
const modeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="behaviorMode"]'));

if (
  !shell ||
  !canvas ||
  !fileInput ||
  !dropZone ||
  !statusEl ||
  !resultEl ||
  !difficultyInput ||
  !difficultyValue ||
  !warmupTapButton ||
  !fileMetaEl ||
  !startBattleButton ||
  !modeNote ||
  modeInputs.length === 0
) {
  throw new Error('Page controls failed to initialize.');
}

type AppStage = 'prepare' | 'ready' | 'battle' | 'result';

const gameCanvas = canvas;
const shellView = shell;
const audioInput = fileInput;
const audioDropZone = dropZone;
const statusView = statusEl;
const resultView = resultEl;
const difficultySlider = difficultyInput;
const difficultyOutput = difficultyValue;
const warmupButton = warmupTapButton;
const fileMeta = fileMetaEl;
const startButton = startBattleButton;
const modeNoteView = modeNote;

let busy = false;
let stage: AppStage = 'prepare';
let preparedAnalysis: AudioAnalysis | null = null;
let selectedMode: RuntimeBehaviorMode = 'rules';

const unavailableLlmProvider: LlmBehaviorProvider = {
  async generate() {
    throw new Error('未配置大模型服务，已回退到规则模式。');
  }
};

const runtime = new GameRuntime(gameCanvas, {
  onStatus(message) {
    renderStatus('battle', message);
  },
  onResult(message) {
    stage = 'result';
    resultView.hidden = false;
    resultView.innerHTML = createResultMarkup(message);
    renderStatus('result', '战斗结束，可以调整设置后再次开始。');
    updateControls();
  }
});

window.addEventListener('resize', () => runtime.resize());
runtime.resize();
renderStatus('idle', '请先导入音频文件，完成准备后再开始正式战斗。');
updateControls();

difficultySlider.addEventListener('input', () => {
  difficultyOutput.value = `${Number(difficultySlider.value).toFixed(1)}x`;
});

for (const input of modeInputs) {
  input.addEventListener('change', () => {
    selectedMode = readSelectedMode();
    updateModeNote();
  });
}

audioInput.addEventListener('change', () => {
  const file = audioInput.files?.[0];
  if (file && !busy && stage !== 'battle') {
    void runWithDisplayedError(() => prepareAudio(file), (message) => {
      renderStatus('error', localizeError(message));
      busy = false;
      updateControls();
    });
  }
});

audioDropZone.addEventListener('dragover', (event) => {
  if (busy || stage === 'battle') return;
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
  if (file && !busy && stage !== 'battle') {
    void runWithDisplayedError(() => prepareAudio(file), (message) => {
      renderStatus('error', localizeError(message));
      busy = false;
      updateControls();
    });
  }
});

startButton.addEventListener('click', () => {
  if (preparedAnalysis && !busy && stage !== 'battle') {
    void runWithDisplayedError(() => startBattle(), (message) => {
      stage = preparedAnalysis ? 'ready' : 'prepare';
      renderStatus('error', localizeError(message));
      busy = false;
      updateControls();
    });
  }
});

async function prepareAudio(file: File): Promise<void> {
  if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|flac|m4a)$/i.test(file.name)) {
    throw new Error('请选择音频文件。');
  }

  runtime.stop();
  busy = true;
  stage = 'prepare';
  preparedAnalysis = null;
  setSelectedFile(file);
  resultView.hidden = true;
  resultView.innerHTML = '';
  updateControls();

  try {
    renderStatus('analysis', '正在解析音频信号。');
    const analysis = await analyzeAudioFile(file, (label, progress) => {
      renderStatus('analysis', `${localizeProgressLabel(label)} ${progress}%`);
    });
    renderStatus('warmup', '正在进行节拍校准。');
    preparedAnalysis = await runHiddenWarmup(analysis);
    stage = 'ready';
    renderStatus('idle', '准备完成。请选择模式和威胁等级，然后开始战斗。');
  } finally {
    busy = false;
    updateControls();
  }
}

async function startBattle(): Promise<void> {
  if (!preparedAnalysis) {
    throw new Error('请先完成音频导入和校准。');
  }

  busy = true;
  stage = 'battle';
  resultView.hidden = true;
  resultView.innerHTML = '';
  selectedMode = readSelectedMode();
  updateControls();

  try {
    renderStatus('battle', selectedMode === 'llm-preferred'
      ? '正在以大模型模式生成战斗行为。'
      : '正在以规则模式生成战斗行为。');
    await runtime.start(preparedAnalysis, Number(difficultySlider.value), {
      behaviorMode: selectedMode,
      llmProvider: selectedMode === 'llm-preferred' ? unavailableLlmProvider : undefined
    });
    gameCanvas.focus();
  } finally {
    busy = false;
    updateControls();
  }
}

async function runHiddenWarmup(analysis: AudioAnalysis): Promise<AudioAnalysis> {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    renderStatus('warmup', attempt === 1
      ? `跟随节拍点击，顺序播放期间记录 ${REQUIRED_WARMUP_TAPS} 次。`
      : `同步样本不足或不稳定，请再记录 ${REQUIRED_WARMUP_TAPS} 次。`);
    const taps = await collectWarmupTaps(analysis);
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

function collectWarmupTaps(analysis: AudioAnalysis): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const context = new AudioContext();
    const source = context.createBufferSource();
    source.buffer = analysis.buffer;
    source.connect(context.destination);

    const taps: number[] = [];
    let startedAt: number | null = null;
    let settled = false;
    let sourceEnded = false;

    const finish = async () => {
      if (settled) return;
      settled = true;
      cleanup();
      source.onended = null;
      try {
        source.stop();
      } catch {
        // ignore stop errors when the preview has already ended
      }
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
      if (startedAt === null || settled) return;
      const elapsed = Math.max(0, context.currentTime - startedAt);
      const songTime = analysis.warmupWindow.start + elapsed;
      if (taps.length > 0 && songTime - taps[taps.length - 1] < MIN_WARMUP_TAP_INTERVAL_SECONDS) {
        return;
      }
      taps.push(songTime);
      warmupButton.classList.add('listening');
      warmupButton.textContent = taps.length >= REQUIRED_WARMUP_TAPS
        ? '样本已记录'
        : `同步点击 ${taps.length}/${REQUIRED_WARMUP_TAPS}`;
      renderStatus('warmup', taps.length >= REQUIRED_WARMUP_TAPS
        ? '同步样本已记录，正在计算校准。'
        : sourceEnded
          ? `音频已播放结束，仍可补足点击：${taps.length}/${REQUIRED_WARMUP_TAPS}`
          : `继续跟随节拍点击：${taps.length}/${REQUIRED_WARMUP_TAPS}`);
      setTimeout(() => warmupButton.classList.remove('listening'), 120);
      if (taps.length >= REQUIRED_WARMUP_TAPS) {
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
    warmupButton.textContent = `同步点击 0/${REQUIRED_WARMUP_TAPS}`;
    warmupButton.addEventListener('click', handleTap);
    window.addEventListener('keydown', handleKeydown);

    context.resume()
      .then(() => {
        startedAt = context.currentTime;
        source.start(0, analysis.warmupWindow.start);
        source.onended = () => {
          sourceEnded = true;
          if (!settled && taps.length < REQUIRED_WARMUP_TAPS) {
            renderStatus('warmup', `音频已播放结束，仍可补足点击：${taps.length}/${REQUIRED_WARMUP_TAPS}`);
          }
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

function updateControls(): void {
  const locked = busy || stage === 'battle';
  audioInput.disabled = locked;
  difficultySlider.disabled = locked;
  startButton.disabled = locked || !preparedAnalysis;
  startButton.textContent = stage === 'result' ? '再次开始战斗' : '开始战斗';
  audioDropZone.classList.toggle('disabled', locked);
  warmupButton.disabled = false;
  shellView.dataset.stage = stage;

  for (const input of modeInputs) {
    input.disabled = locked;
  }
}

function readSelectedMode(): RuntimeBehaviorMode {
  const checked = modeInputs.find((input) => input.checked);
  return checked?.value === 'llm-preferred' ? 'llm-preferred' : 'rules';
}

function updateModeNote(): void {
  modeNoteView.textContent = selectedMode === 'llm-preferred'
    ? '大模型模式：优先请求模型生成敌人行动；未配置模型服务时会自动回退到规则模式。'
    : '规则模式：使用本地节奏规则生成敌人行动，稳定且响应最快。';
}

function setSelectedFile(file: File): void {
  fileMeta.textContent = file.name;
}

function renderStatus(phase: StatusPhase, message: string): void {
  statusView.innerHTML = createStatusMarkup(phase, message);
}

function localizeProgressLabel(label: string): string {
  const labels: Record<string, string> = {
    'Reading file': '读取文件',
    'Reading audio file': '读取音频文件',
    'Decoding audio': '解码音频',
    'Analyzing waveform': '分析波形',
    'Detecting beats': '检测节拍',
    'Mapping song structure': '映射歌曲结构',
    Ready: '准备完成',
    'Segmenting structure': '划分段落',
    'Preparing combat': '准备战斗'
  };

  return labels[label] ?? '分析音频';
}

function localizeError(message: string): string {
  if (/audio file/i.test(message)) return '请选择音频文件。';
  if (/decode|encoding|format/i.test(message)) return '无法解码该音频，请换用 MP3、WAV、OGG 或 FLAC。';
  return message || '操作失败，请重试。';
}
