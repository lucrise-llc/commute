const WRITE_TOKEN_TTL_SECONDS = 3_600;
const READ_TOKEN_TTL_SECONDS = 600;

export type ChangeRef = {
  projectId: string;
  changeId: string;
};

export function changeRepoName({ projectId, changeId }: ChangeRef): string {
  return `${projectId}.${changeId}`;
}

type RemoteParams = {
  origin: string;
  projectId: string;
  repoId: string;
};

export function commuteRemote({ origin, projectId, repoId }: RemoteParams): string {
  return `${origin}/git/${projectId}/${repoId}.git`;
}

export type IssuedToken = {
  token: string;
  tokenExpiresAt: string;
};

export function issueWriteToken(repo: ArtifactsRepo): Promise<IssuedToken> {
  return issueToken({ repo, scope: 'write', ttlSeconds: WRITE_TOKEN_TTL_SECONDS });
}

export function issueReadToken(repo: ArtifactsRepo): Promise<IssuedToken> {
  return issueToken({ repo, scope: 'read', ttlSeconds: READ_TOKEN_TTL_SECONDS });
}

type IssueTokenParams = {
  repo: ArtifactsRepo;
  scope: 'read' | 'write';
  ttlSeconds: number;
};

// A token from createToken ends in "?expires=<time>"; git sends only the part before it as the password.
async function issueToken({ repo, scope, ttlSeconds }: IssueTokenParams): Promise<IssuedToken> {
  const created = await repo.createToken(scope, ttlSeconds);
  const [token = ''] = created.plaintext.split('?expires=');
  return { token, tokenExpiresAt: created.expiresAt };
}
