import { DurableObject } from 'cloudflare:workers';

const INACTIVITY_TIMEOUT_MS = 300_000;
const EXEC_TIMEOUT_MS = 120_000;
const CONFLICTS_MAX = 200;
const ERROR_OUTPUT_CHARS_MAX = 500;
const EXIT_CODE_CLEAN = 0;
const EXIT_CODE_CONFLICT = 1;
// In a file and directory conflict, merge-tree renames the file to <path>~<ref>, with / in the ref written as _.
const RENAMED_SIDE_SUFFIX = /~refs_(left|right)$/;

// Fetches the heads of both changes into an empty repository and merges them without a worktree. Exit code 0 means
// a clean merge and 1 a conflict, as `git merge-tree` reports; any other code is a failure of the check itself.
const MERGE_SCRIPT = `set -u
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
git init -q || exit 3
timeout 60 git fetch -q --no-tags "https://commute:\${LEFT_TOKEN}@\${LEFT_REMOTE#https://}" main:refs/left || exit 3
timeout 60 git fetch -q --no-tags "https://commute:\${RIGHT_TOKEN}@\${RIGHT_REMOTE#https://}" main:refs/right || exit 3
timeout 60 git merge-tree --write-tree --name-only --no-messages refs/left refs/right
`;

export type MergeSide = {
  remote: string;
  token: string;
};

type MergeCheckParams = {
  left: MergeSide;
  right: MergeSide;
};

export type MergeResult = {
  outcome: 'clean' | 'conflict';
  conflicts: string[];
};

// A runner merges the heads of two changes in a container whose image includes git. The coordinator keeps a pool of
// runners and moves a job to the next runner when one fails.
export class Runner extends DurableObject<Env> {
  async mergeCheck({ left, right }: MergeCheckParams): Promise<MergeResult> {
    const container = this.ctx.container;
    if (container === undefined) {
      throw new Error('The Runner class has no container.');
    }
    if (!container.running) {
      container.start({ enableInternet: true });
    }
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

    const process = await container.exec(['bash', '-c', MERGE_SCRIPT], {
      env: { LEFT_REMOTE: left.remote, LEFT_TOKEN: left.token, RIGHT_REMOTE: right.remote, RIGHT_TOKEN: right.token },
      signal: AbortSignal.timeout(EXEC_TIMEOUT_MS)
    });
    const output = await process.output();
    const decoder = new TextDecoder();
    if (output.exitCode !== EXIT_CODE_CLEAN && output.exitCode !== EXIT_CODE_CONFLICT) {
      const stderr = scrub({ text: decoder.decode(output.stderr), secrets: [left.token, right.token] });
      throw new Error(`The merge check exited ${output.exitCode}: ${stderr.slice(-ERROR_OUTPUT_CHARS_MAX)}`);
    }
    const [, ...conflicts] = decoder
      .decode(output.stdout)
      .split('\n')
      .filter((line) => line !== '')
      .map((path) => path.replace(RENAMED_SIDE_SUFFIX, ''));
    return {
      outcome: output.exitCode === EXIT_CODE_CLEAN ? 'clean' : 'conflict',
      conflicts: [...new Set(conflicts)].slice(0, CONFLICTS_MAX)
    };
  }
}

type ScrubParams = {
  text: string;
  secrets: string[];
};

// Git can echo a remote URL, and the URL carries a token.
function scrub({ text, secrets }: ScrubParams): string {
  let scrubbed = text;
  for (const secret of secrets) {
    scrubbed = scrubbed.replaceAll(secret, '<token>');
  }
  return scrubbed;
}
