export type ActionKind = 'attack' | 'block' | 'dash';
export type JudgmentRank = 'perfect' | 'good' | 'miss';

export interface RhythmOptions {
  bpm: number;
  firstBeat: number;
  duration: number;
  beatGrid?: number[];
  perfectWindowMs?: number;
  goodWindowMs?: number;
}

export interface Judgment {
  rank: JudgmentRank;
  timeDiffMs: number;
  damageMultiplier: number;
  scoreBonus: number;
  perfectDefense: boolean;
}

export interface RhythmStats {
  perfect: number;
  good: number;
  miss: number;
  actions: number;
  combo: number;
  maxCombo: number;
  accuracy: number;
}

export interface RhythmTracker {
  judge(time: number, action: ActionKind): Judgment;
  isOnBeat(time: number): boolean;
  timeToNextBeat(time: number): number;
  getBeatInterval(): number;
  getStats(): RhythmStats;
}

interface RhythmState {
  options: Omit<Required<RhythmOptions>, 'beatGrid'> & { beatGrid: number[] };
  stats: RhythmStats;
}

export function createRhythmTracker(options: RhythmOptions): RhythmTracker {
  const state: RhythmState = {
    options: {
      ...options,
      bpm: normalizeBpm(options.bpm),
      beatGrid: normalizeBeatGrid(options.beatGrid, options.duration),
      perfectWindowMs: options.perfectWindowMs ?? 80,
      goodWindowMs: options.goodWindowMs ?? 200
    },
    stats: {
      perfect: 0,
      good: 0,
      miss: 0,
      actions: 0,
      combo: 0,
      maxCombo: 0,
      accuracy: 100
    }
  };

  return {
    judge(time, action) {
      const timeDiffMs = nearestBeatDiffMs(state.options, time);
      const absDiff = Math.abs(timeDiffMs);
      const rank =
        absDiff <= state.options.perfectWindowMs
          ? 'perfect'
          : absDiff <= state.options.goodWindowMs
            ? 'good'
            : 'miss';

      updateStats(state.stats, rank);
      const comboBonus = rank === 'miss' ? 0 : Math.floor(state.stats.combo / 5) * 10;
      return {
        rank,
        timeDiffMs,
        damageMultiplier: rank === 'perfect' ? 2 : rank === 'good' ? 1.2 : 1,
        scoreBonus: rank === 'perfect' ? 100 + comboBonus : rank === 'good' ? 50 + comboBonus : 0,
        perfectDefense: rank === 'perfect' && (action === 'block' || action === 'dash')
      };
    },

    isOnBeat(time) {
      return Math.abs(nearestBeatDiffMs(state.options, time)) <= state.options.perfectWindowMs;
    },

    timeToNextBeat(time) {
      const nextGridBeat = nextGridBeatAtOrAfter(state.options.beatGrid, time);
      if (nextGridBeat !== null) {
        return Math.max(0, nextGridBeat - time);
      }

      const interval = beatIntervalSeconds(state.options.bpm);
      const elapsed = time - state.options.firstBeat;
      const nextIndex = Math.floor(elapsed / interval) + 1;
      return Math.max(0, state.options.firstBeat + nextIndex * interval - time);
    },

    getBeatInterval() {
      return beatIntervalSeconds(state.options.bpm);
    },

    getStats() {
      return { ...state.stats };
    }
  };
}

function normalizeBpm(bpm: number): number {
  let value = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  while (value > 180) value /= 2;
  while (value < 60) value *= 2;
  return Math.round(value);
}

function beatIntervalSeconds(bpm: number): number {
  return 60 / bpm;
}

function nearestBeatDiffMs(options: RhythmState['options'], time: number): number {
  const gridDiff = nearestGridBeatDiffSeconds(options.beatGrid, time);
  if (gridDiff !== null) {
    return gridDiff * 1000;
  }

  const interval = beatIntervalSeconds(options.bpm);
  const beatIndex = Math.round((time - options.firstBeat) / interval);
  const beatTime = options.firstBeat + beatIndex * interval;
  return (time - beatTime) * 1000;
}

function normalizeBeatGrid(beatGrid: number[] | undefined, duration: number): number[] {
  if (!beatGrid) return [];
  const upperBound = Math.max(0, duration) + 0.001;
  return [...new Set(beatGrid
    .filter((time) => Number.isFinite(time) && time >= 0 && time <= upperBound)
    .map((time) => Math.round(time * 1000) / 1000))]
    .sort((left, right) => left - right);
}

function nearestGridBeatDiffSeconds(beatGrid: number[], time: number): number | null {
  if (beatGrid.length === 0) return null;
  let low = 0;
  let high = beatGrid.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (beatGrid[middle] < time) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const next = beatGrid[low];
  const previous = beatGrid[low - 1];
  if (next === undefined) return previous === undefined ? null : time - previous;
  if (previous === undefined) return time - next;
  return Math.abs(time - previous) <= Math.abs(time - next) ? time - previous : time - next;
}

function nextGridBeatAtOrAfter(beatGrid: number[], time: number): number | null {
  if (beatGrid.length === 0) return null;
  let low = 0;
  let high = beatGrid.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (beatGrid[middle] < time) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return beatGrid[low] ?? null;
}

function updateStats(stats: RhythmStats, rank: JudgmentRank): void {
  stats.actions += 1;
  if (rank === 'perfect') {
    stats.perfect += 1;
    stats.combo += 1;
  } else if (rank === 'good') {
    stats.good += 1;
    stats.combo += 1;
  } else {
    stats.miss += 1;
    stats.combo = 0;
  }
  stats.maxCombo = Math.max(stats.maxCombo, stats.combo);
  stats.accuracy = Math.round(((stats.perfect * 100) + (stats.good * 50)) / stats.actions);
}
