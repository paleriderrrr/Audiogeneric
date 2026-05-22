import type { WorldEvent } from '../core/combat.js';

export interface CombatFeedback {
  text: string;
  tone: 'success' | 'warning' | 'danger';
  playerFlash: 'none' | 'guard' | 'hurt';
  bossFlash: 'none' | 'hit';
  screenShake: number;
}

const FEEDBACK_PRIORITY: Array<{
  type: WorldEvent['type'];
  feedback: CombatFeedback;
}> = [
  {
    type: 'dash-cleared-projectiles',
    feedback: {
      text: '切开弹幕',
      tone: 'success',
      playerFlash: 'guard',
      bossFlash: 'none',
      screenShake: 2
    }
  },
  {
    type: 'boss-break',
    feedback: {
      text: '核心击穿',
      tone: 'success',
      playerFlash: 'none',
      bossFlash: 'hit',
      screenShake: 5
    }
  },
  {
    type: 'perfect-defense',
    feedback: {
      text: '完美防御',
      tone: 'success',
      playerFlash: 'guard',
      bossFlash: 'none',
      screenShake: 3
    }
  },
  {
    type: 'attack-hit',
    feedback: {
      text: '节拍命中',
      tone: 'success',
      playerFlash: 'none',
      bossFlash: 'hit',
      screenShake: 2
    }
  },
  {
    type: 'player-hit',
    feedback: {
      text: '注意规避',
      tone: 'danger',
      playerFlash: 'hurt',
      bossFlash: 'none',
      screenShake: 4
    }
  },
  {
    type: 'player-blocked-hit',
    feedback: {
      text: '防御成功',
      tone: 'success',
      playerFlash: 'guard',
      bossFlash: 'none',
      screenShake: 1
    }
  },
  {
    type: 'near-graze',
    feedback: {
      text: '极限擦弹',
      tone: 'success',
      playerFlash: 'guard',
      bossFlash: 'none',
      screenShake: 0
    }
  },
  {
    type: 'boss-charged',
    feedback: {
      text: '冲撞压制',
      tone: 'warning',
      playerFlash: 'none',
      bossFlash: 'none',
      screenShake: 3
    }
  },
  {
    type: 'boss-laser',
    feedback: {
      text: '光束锁定',
      tone: 'warning',
      playerFlash: 'none',
      bossFlash: 'none',
      screenShake: 2
    }
  },
  {
    type: 'boss-sweep',
    feedback: {
      text: '近身扫击',
      tone: 'warning',
      playerFlash: 'none',
      bossFlash: 'none',
      screenShake: 2
    }
  },
  {
    type: 'projectiles-fired',
    feedback: {
      text: '规避弹幕',
      tone: 'warning',
      playerFlash: 'none',
      bossFlash: 'none',
      screenShake: 1
    }
  },
  {
    type: 'dash-blocked-by-cooldown',
    feedback: {
      text: '冲刺冷却中',
      tone: 'warning',
      playerFlash: 'none',
      bossFlash: 'none',
      screenShake: 0
    }
  },
  {
    type: 'attack-blocked-by-cooldown',
    feedback: {
      text: '攻击冷却中',
      tone: 'warning',
      playerFlash: 'none',
      bossFlash: 'none',
      screenShake: 0
    }
  }
];

export function pickCombatFeedback(events: WorldEvent[]): CombatFeedback | null {
  for (const candidate of FEEDBACK_PRIORITY) {
    if (events.some((event) => event.type === candidate.type)) {
      return candidate.feedback;
    }
  }

  return null;
}
