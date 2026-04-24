import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithDisplayedError } from '../src/ui/task.js';

test('consumes task failures after reporting them to the UI', async () => {
  const messages: string[] = [];

  await assert.doesNotReject(async () => {
    await runWithDisplayedError(
      async () => {
        throw new Error('broken audio');
      },
      (message: string) => {
        messages.push(message);
      }
    );
  });

  assert.deepEqual(messages, ['broken audio']);
});
