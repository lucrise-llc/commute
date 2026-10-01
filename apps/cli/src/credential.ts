import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { text } from 'node:stream/consumers';

import { git } from './git.ts';

const TOKEN_USERNAME = 'commute';

// Git calls this helper with get, store, or erase, and sends the request attributes on stdin. Commute keeps the
// change token in .git/commute/token, so only get has work to do.
export async function runCredential(args: string[]): Promise<number> {
  await text(process.stdin);
  if (args[0] !== 'get') {
    return 0;
  }
  const gitDir = await git({ args: ['rev-parse', '--git-dir'], cwd: process.cwd() });
  const token = (await readFile(join(resolve(gitDir), 'commute', 'token'), 'utf8')).trim();
  process.stdout.write(`username=${TOKEN_USERNAME}\npassword=${token}\n`);
  return 0;
}
