import type { MergeResult, MergeSide } from './runner';

import { logError } from './log';

// Each project has its own runners, so one team's code never runs in a container that serves another project.
const RUNNERS_PER_PROJECT = 2;

type MergeOnPoolParams = {
  env: Env;
  projectId: string;
  pairKey: string;
  left: MergeSide;
  right: MergeSide;
};

// Sends the job to the project runner that the pair selects, and to the next runner when one fails, so one stuck
// container does not stop the merge checks of the project.
export async function mergeOnRunnerPool({
  env,
  projectId,
  pairKey,
  left,
  right
}: MergeOnPoolParams): Promise<MergeResult> {
  const first = poolIndex(pairKey);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < RUNNERS_PER_PROJECT; attempt += 1) {
    const runner = `${projectId}.runner-${(first + attempt) % RUNNERS_PER_PROJECT}`;
    try {
      return await env.RUNNER.getByName(runner).mergeCheck({ left, right });
    } catch (error) {
      lastError = error;
      logError({ event: 'runner_failed', runner, pairKey, error });
    }
  }
  throw new Error('NO_RUNNER_ANSWERED', { cause: lastError });
}

function poolIndex(pairKey: string): number {
  let sum = 0;
  for (const character of pairKey) {
    sum += character.codePointAt(0) ?? 0;
  }
  return sum % RUNNERS_PER_PROJECT;
}
