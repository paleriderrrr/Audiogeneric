import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TestToolOptions {
  domains: string[];
  pattern?: string;
  list: boolean;
  help: boolean;
}

export const TEST_GROUPS = {
  audio: [
    'audio-file-runner.test.js',
    'audio-primitives.test.js',
    'audio-pipeline.test.js',
    'rhythm.test.js'
  ],
  behavior: [
    'behavior-primitive-plan.test.js',
    'behavior-strategy.test.js',
    'behavior.test.js',
    'mimo-provider.test.js',
    'proxy-provider.test.js'
  ],
  combat: [
    'combat.test.js',
    'feedback.test.js'
  ],
  runtime: [
    'runtime.test.js',
    'status-presenter.test.js',
    'ui-task.test.js'
  ],
  sound: [
    'sound-feedback.test.js'
  ],
  ui: [
    'runtime.test.js',
    'status-presenter.test.js',
    'ui-sound.test.js',
    'ui-task.test.js'
  ]
} as const;

export type TestDomain = keyof typeof TEST_GROUPS;

const DEFAULT_DOMAINS: TestDomain[] = ['audio', 'behavior', 'combat', 'runtime', 'sound', 'ui'];

export function parseTestToolArgs(argv: string[]): TestToolOptions {
  const domains: string[] = [];
  let pattern: string | undefined;
  let list = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--list') {
      list = true;
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--grep' || arg === '--test-name-pattern') {
      pattern = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--grep=')) {
      pattern = arg.slice('--grep='.length);
    } else if (arg.startsWith('--test-name-pattern=')) {
      pattern = arg.slice('--test-name-pattern='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown test option "${arg}".`);
    } else {
      domains.push(arg);
    }
  }

  return {
    domains: domains.length > 0 ? domains : [...DEFAULT_DOMAINS],
    pattern,
    list,
    help
  };
}

export function resolveTestFiles(domains: string[], distTestsDir: string): string[] {
  const files: string[] = [];
  const seen = new Set<string>();

  for (const domain of domains) {
    if (!isTestDomain(domain)) {
      throw new Error(`Unknown test domain "${domain}". Known domains: ${Object.keys(TEST_GROUPS).join(', ')}.`);
    }

    for (const file of TEST_GROUPS[domain]) {
      const resolved = path.join(distTestsDir, file).replace(/\\/g, '/');
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      files.push(resolved);
    }
  }

  return files;
}

export function buildNodeTestArgs(files: string[], pattern?: string): string[] {
  const args = ['--test', ...files];
  if (pattern) {
    args.push('--test-name-pattern', pattern);
  }
  return args;
}

function isTestDomain(value: string): value is TestDomain {
  return Object.prototype.hasOwnProperty.call(TEST_GROUPS, value);
}

function printUsage(): void {
  console.log([
    'Usage: npm run test:tool -- [domain...] [--grep <pattern>] [--list]',
    '',
    `Domains: ${Object.keys(TEST_GROUPS).join(', ')}`,
    '',
    'Examples:',
    '  npm run test:tool -- combat',
    '  npm run test:tool -- combat runtime sound ui',
    '  npm run test:tool -- sound --grep "player operation"'
  ].join('\n'));
}

function runCli(argv: string[]): number {
  const options = parseTestToolArgs(argv);
  if (options.help) {
    printUsage();
    return 0;
  }

  const distTestsDir = path.join(process.cwd(), 'dist-test', 'tests');
  const files = resolveTestFiles(options.domains, distTestsDir);

  if (options.list) {
    console.log(files.join('\n'));
    return 0;
  }

  const startedAt = performance.now();
  console.log(`[test-tool] domains=${options.domains.join(',')} files=${files.length}${options.pattern ? ` grep=${options.pattern}` : ''}`);
  const result = spawnSync(process.execPath, buildNodeTestArgs(files, options.pattern), {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
  const elapsed = Math.round(performance.now() - startedAt);
  console.log(`[test-tool] completed in ${elapsed}ms`);

  if (typeof result.status === 'number') return result.status;
  if (result.error) {
    console.error(result.error.message);
  }
  return 1;
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (path.resolve(currentFile) === invokedFile) {
  process.exitCode = runCli(process.argv.slice(2));
}
