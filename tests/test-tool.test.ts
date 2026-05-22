import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNodeTestArgs,
  parseTestToolArgs,
  resolveTestFiles
} from './tooling/test-runner.js';

test('test tool resolves focused domains into compiled test files', () => {
  const files = resolveTestFiles(['combat', 'sound'], 'dist-test/tests');

  assert.deepEqual(files, [
    'dist-test/tests/combat.test.js',
    'dist-test/tests/feedback.test.js',
    'dist-test/tests/sound-feedback.test.js'
  ]);
});

test('test tool parses grep and domain arguments for iteration', () => {
  const parsed = parseTestToolArgs(['combat', 'ui', '--grep', 'boss|button']);

  assert.deepEqual(parsed.domains, ['combat', 'ui']);
  assert.equal(parsed.pattern, 'boss|button');
  assert.equal(parsed.list, false);
});

test('test tool rejects unknown domains with a helpful error', () => {
  assert.throws(
    () => resolveTestFiles(['unknown'], 'dist-test/tests'),
    /Unknown test domain "unknown"/
  );
});

test('test tool builds node test arguments with an optional pattern', () => {
  const args = buildNodeTestArgs(['dist-test/tests/combat.test.js'], 'laser');

  assert.deepEqual(args, [
    '--test',
    'dist-test/tests/combat.test.js',
    '--test-name-pattern',
    'laser'
  ]);
});
