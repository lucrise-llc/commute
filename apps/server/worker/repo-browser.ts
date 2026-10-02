// Reads trees, files, and commits of a repository through the Artifacts binding. The coordinator gives the head of
// each ref, because the binding cannot list refs.

const TEXT_BYTES_MAX = 64_000;
const COMMITS_MAX = 50;
const TRUNK_HISTORY_MAX = 1_000;

type FolderParams = {
  repo: ArtifactsRepo;
  commit: string;
  path: string;
};

// The entries of the folder at path, or null when the commit has no folder there. An empty path is the root.
export async function readFolder({ repo, commit, path }: FolderParams): Promise<ArtifactsTreeEntry[] | null> {
  const metadata = await repo.readCommit(commit);
  if (metadata === null) {
    throw new Error('COMMIT_NOT_FOUND');
  }
  let entries = await repo.readTree(metadata.treeHash);
  for (const segment of path === '' ? [] : path.split('/')) {
    const entry = entries?.find((candidate) => candidate.name === segment);
    if (entry?.type !== 'tree') {
      return null;
    }
    entries = await repo.readTree(entry.hash);
  }
  return entries;
}

type FileText = {
  size: number;
  text: string | null;
};

// The text of the file at path, or null when the commit has no file there. text is null for a file that is too
// large or is not UTF-8.
export async function readText({ repo, commit, path }: FolderParams): Promise<FileText | null> {
  const blob = await repo.readFile({ ref: commit, path });
  if (blob === null) {
    return null;
  }
  if (blob.size > TEXT_BYTES_MAX) {
    return { size: blob.size, text: null };
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await blob.arrayBuffer());
    return { size: blob.size, text };
  } catch {
    return { size: blob.size, text: null };
  }
}

type CommitsParams = {
  repo: ArtifactsRepo;
  head: string;
  base: string | null;
};

// The commits on the first-parent chain of head, newest first. For a change, the list stops at the first commit that
// trunk already had at the change's base.
export async function readCommits({ repo, head, base }: CommitsParams): Promise<ArtifactsCommitMetadata[]> {
  const trunkCommits = base === null ? [] : await repo.log({ ref: base, limit: TRUNK_HISTORY_MAX });
  const stopAt = new Set(trunkCommits.map((commit) => commit.hash));
  const commits: ArtifactsCommitMetadata[] = [];
  for (const commit of await repo.log({ ref: head, limit: COMMITS_MAX })) {
    if (stopAt.has(commit.hash)) {
      break;
    }
    commits.push(commit);
  }
  return commits;
}
