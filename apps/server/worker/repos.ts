const WRITE_TOKEN_TTL_SECONDS = 3_600;

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

export type WriteToken = {
  token: string;
  tokenExpiresAt: string;
};

// A token from createToken ends in "?expires=<time>"; git sends only the part before it as the password.
export async function issueWriteToken(repo: ArtifactsRepo): Promise<WriteToken> {
  const created = await repo.createToken('write', WRITE_TOKEN_TTL_SECONDS);
  const [token = ''] = created.plaintext.split('?expires=');
  return { token, tokenExpiresAt: created.expiresAt };
}
