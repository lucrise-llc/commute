import type { ChangeStarted } from '@commute/api-client';

import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve } from 'node:path';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { createClient, startChange } from '@commute/api-client';

import type { ServerConfig } from './server.ts';

import { git } from './git.ts';
import { describeOverlap } from './overlaps.ts';
import { writeChangeContext } from './change-context.ts';
import { describeApiError, serverFromEnv } from './server.ts';

const CLI_PATH = fileURLToPath(new URL('./main.ts', import.meta.url));
const TRUNK_BRANCH = 'main';
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export const START_USAGE = 'commute start "<intent>" --paths <path,path> [--dir <directory>] [--json]';

export async function runStart(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      paths: { type: 'string' },
      dir: { type: 'string' },
      json: { type: 'boolean', default: false }
    }
  });
  const [intent] = positionals;
  if (intent === undefined || values.paths === undefined) {
    throw new Error(`Usage: ${START_USAGE}`);
  }
  const server = serverFromEnv();

  const { data, error } = await startChange({
    client: createClient({ baseUrl: server.url }),
    path: { projectId: server.projectId },
    body: { intent, paths: normalizePaths(values.paths) }
  });
  if (data === undefined) {
    throw new Error(`commute start failed: ${describeApiError(error)}`);
  }

  const directory = resolve(values.dir ?? data.changeId);
  await createWorkingCopy({ directory, change: data, server });

  if (values.json) {
    const { changeId, remote, baseCommit, overlaps } = data;
    console.log(JSON.stringify({ changeId, remote, directory, baseCommit, overlaps }));
    return 0;
  }
  console.log(`change   ${data.changeId}`);
  console.log(`remote   ${data.remote}`);
  console.log(`dir      ${relative(process.cwd(), directory) || '.'}`);
  for (const overlap of data.overlaps) {
    console.log(`overlap  ${describeOverlap(overlap)}`);
  }
  return 0;
}

// Accepts the paths the way people type them: "src/cart/, ./config/discounts.json".
function normalizePaths(list: string): string[] {
  const paths = list
    .split(',')
    .map((path) => path.trim().replace(/^\.\//, '').replace(/\/+$/, ''))
    .filter((path) => path !== '');
  return [...new Set(paths)];
}

type WorkingCopyParams = {
  directory: string;
  change: ChangeStarted;
  server: ServerConfig;
};

// Creates the working copy without putting the token in a URL or an argument. Git asks `commute credential`, which
// reads the token from .git/commute/token.
async function createWorkingCopy({ directory, change, server }: WorkingCopyParams): Promise<void> {
  await mkdir(directory);
  await git({ args: ['init', '-q', '-b', TRUNK_BRANCH], cwd: directory });
  const tokenDirectory = join(directory, '.git', 'commute');
  await mkdir(tokenDirectory, { mode: PRIVATE_DIRECTORY_MODE });
  const tokenFile = join(tokenDirectory, 'token');
  await writeFile(tokenFile, `${change.token}\n`, { mode: PRIVATE_FILE_MODE });
  await chmod(tokenFile, PRIVATE_FILE_MODE);

  await git({ args: ['config', '--add', 'credential.helper', ''], cwd: directory });
  await git({
    args: [
      'config',
      '--add',
      'credential.helper',
      `!${shellQuote(process.execPath)} ${shellQuote(CLI_PATH)} credential`
    ],
    cwd: directory
  });
  await writeChangeContext({
    context: { url: server.url, projectId: server.projectId, changeId: change.changeId, cursor: 0 },
    cwd: directory
  });
  await git({ args: ['remote', 'add', 'origin', change.remote], cwd: directory });
  await git({ args: ['fetch', '-q', 'origin', TRUNK_BRANCH], cwd: directory });
  await git({ args: ['checkout', '-q', '-B', TRUNK_BRANCH, `origin/${TRUNK_BRANCH}`], cwd: directory });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
