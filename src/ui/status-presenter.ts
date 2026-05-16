export type StatusPhase = 'idle' | 'analysis' | 'warmup' | 'battle' | 'result' | 'error';

const STATUS_LABELS: Record<StatusPhase, string> = {
  idle: '待命',
  analysis: '解析',
  warmup: '校准',
  battle: '战斗',
  result: '结果',
  error: '错误'
};

export function createStatusMarkup(phase: StatusPhase, message: string): string {
  return `
    <div class="status-card status-${phase}">
      <div class="status-phase">${STATUS_LABELS[phase]}</div>
      <div class="status-message">${escapeHtml(message)}</div>
    </div>
  `;
}

export function createResultMarkup(result: string): string {
  const parts = result.split('/').map((part) => part.trim()).filter(Boolean);
  const headline = parts.shift() ?? '战斗完成';
  const rows = parts.map((part) => {
    const separator = part.indexOf(' ');
    if (separator === -1) {
      return `<div class="result-stat"><span class="result-label">${escapeHtml(part)}</span></div>`;
    }

    const label = part.slice(0, separator);
    const value = part.slice(separator + 1);
    return `
      <div class="result-stat">
        <span class="result-label">${escapeHtml(label)}</span>
        <span class="result-value">${escapeHtml(value)}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="result-card">
      <div class="result-headline">${escapeHtml(headline)}</div>
      <div class="result-grid">${rows}</div>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
