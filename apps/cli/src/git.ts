import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 120_000;

type GitParams = {
  args: string[];
  cwd: string;
};

export async function git({ args, cwd }: GitParams): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: GIT_TIMEOUT_MS
    });
    return stdout.trim();
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : '';
    throw new Error(`git ${args[0] ?? ''} failed${stderr === '' ? '' : `: ${stderr}`}`, { cause: error });
  }
}
