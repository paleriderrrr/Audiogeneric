import test from 'node:test';
import assert from 'node:assert/strict';
import { createResultMarkup, createStatusMarkup } from '../src/ui/status-presenter.js';

test('renders status markup with phase label and message', () => {
  const markup = createStatusMarkup('battle', '敌人压力上升');

  assert.equal(markup.includes('战斗'), true);
  assert.equal(markup.includes('敌人压力上升'), true);
  assert.equal(markup.includes('status-card'), true);
});

test('renders result markup into headline and stat rows', () => {
  const markup = createResultMarkup('同步完成 / 分数 820 / 伤害 143 / 最大连击 9 / 准确率 88%');

  assert.equal(markup.includes('同步完成'), true);
  assert.equal(markup.includes('分数'), true);
  assert.equal(markup.includes('820'), true);
  assert.equal(markup.includes('准确率'), true);
  assert.equal(markup.includes('88%'), true);
});
