import { logError } from './log';
import { changeRepoName } from './repos';

const GIT_PATH_PATTERN = /^\/git\/([a-z][a-z0-9-]{0,38}[a-z0-9])\/(trunk|c-[1-9][0-9]{0,8})\.git(\/.+)$/;
const RECEIVE_PACK = '/git-receive-pack';
const NOT_FOUND = 404;

type GitRequestParams = {
  request: Request;
  env: Env;
};

// The Commute remote. Git smart HTTP passes through to Artifacts with the agent's own token, and Artifacts checks
// that token against the repository. After Artifacts accepts a push to a change, the coordinator reads the new head
// before the response reaches git, so Commute knows about the push before `git push` returns.
export async function handleGit({ request, env }: GitRequestParams): Promise<Response> {
  const url = new URL(request.url);
  const [, projectId, repoId, rest] = GIT_PATH_PATTERN.exec(url.pathname) ?? [];
  if (projectId === undefined || repoId === undefined || rest === undefined) {
    return new Response('Not a Commute remote.\n', { status: NOT_FOUND });
  }

  const repoName = repoId === 'trunk' ? projectId : changeRepoName({ projectId, changeId: repoId });
  const response = await fetch(`${env.ARTIFACTS_GIT_ORIGIN}/${repoName}.git${rest}${url.search}`, {
    method: request.method,
    headers: request.headers,
    body: request.body
  });
  const isChangePush = request.method === 'POST' && rest === RECEIVE_PACK && repoId !== 'trunk';
  if (!isChangePush || !response.ok) {
    return response;
  }

  const body = await response.arrayBuffer();
  try {
    await env.COORDINATOR.getByName(projectId).recordPush({ projectId, changeId: repoId });
  } catch (error) {
    logError({ event: 'push_not_recorded', projectId, changeId: repoId, error });
  }
  return new Response(body, response);
}
