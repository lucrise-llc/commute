import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { text } from 'node:stream/consumers';

import { git } from './git.ts';
import { readChangeContext } from './change-context.ts';

const TOKEN_USERNAME = 'commute';

// Git calls this helper with get, store, or erase, and sends the request attributes on stdin. Commute keeps the
// change token in .git/commute/token, so only get has work to do, and only for the Commute server of the change.
export async function runCredential(args: string[]): Promise<number> {
  const attributes = parseAttributes(await text(process.stdin));
  if (args[0] !== 'get') {
    return 0;
  }
  const context = await readChangeContext(process.cwd());
  if (`${attributes.get('protocol')}://${attributes.get('host')}` !== new URL(context.url).origin) {
    return 0;
  }
  const gitDir = await git({ args: ['rev-parse', '--git-dir'], cwd: process.cwd() });
  const token = (await readFile(join(resolve(gitDir), 'commute', 'token'), 'utf8')).trim();
  process.stdout.write(`username=${TOKEN_USERNAME}\npassword=${token}\n`);
  return 0;
}

function parseAttributes(input: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const line of input.split('\n')) {
    const separator = line.indexOf('=');
    if (separator > 0) {
      attributes.set(line.slice(0, separator), line.slice(separator + 1));
    }
  }
  return attributes;
}
