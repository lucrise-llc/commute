import type { Runner } from './runner';

import { logError } from './log';
import { HEAD_MOVED, LAND_CONFLICT } from './runner';

// Each project has its own runners, so one team's code never runs in a container that serves another project.
const RUNNERS_PER_PROJECT = 2;

// Failures that come from the repositories, not from the runner, so another runner would fail the same way.
const REPOSITORY_ERRORS = new Set([HEAD_MOVED, LAND_CONFLICT]);

type OnRunnerPoolParams<Result> = {
  env: Env;
  projectId: string;
  jobKey: string;
  task: (runner: DurableObjectStub<Runner>) => Promise<Result>;
};

// Sends the task to the project runner that the job key selects, and to the next runner when one fails, so one stuck
// container does not stop the jobs of the project.
export async function onRunnerPool<Result>({
  env,
  projectId,
  jobKey,
  task
}: OnRunnerPoolParams<Result>): Promise<Result> {
  const first = poolIndex(jobKey);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < RUNNERS_PER_PROJECT; attempt += 1) {
    const runner = `${projectId}.runner-${(first + attempt) % RUNNERS_PER_PROJECT}`;
    try {
      return await task(env.RUNNER.getByName(runner));
    } catch (error) {
      if (error instanceof Error && REPOSITORY_ERRORS.has(error.message)) {
        throw error;
      }
      lastError = error;
      logError({ event: 'runner_failed', runner, jobKey, error });
    }
  }
  throw new Error('NO_RUNNER_ANSWERED', { cause: lastError });
}

function poolIndex(jobKey: string): number {
  let sum = 0;
  for (const character of jobKey) {
    sum += character.codePointAt(0) ?? 0;
  }
  return sum % RUNNERS_PER_PROJECT;
}
