// Reads trees, files, and commits of a repository through the Artifacts binding. The coordinator gives the head of
// each ref, because the binding cannot list refs.

const TREE_READS_MAX = 200;
const CHANGED_FILES_MAX = 50;
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

type ChangedFilesParams = {
  repo: ArtifactsRepo;
  fromCommit: string;
  toCommit: string;
};

type ChangedFiles = {
  paths: string[];
  isTruncated: boolean;
};

type PendingTrees = {
  prefix: string;
  fromTree: string | null;
  toTree: string | null;
};

// The files that differ between two commits. A folder that exists on one side only contributes all of its files.
export async function changedFiles({ repo, fromCommit, toCommit }: ChangedFilesParams): Promise<ChangedFiles> {
  const [from, to] = await Promise.all([repo.readCommit(fromCommit), repo.readCommit(toCommit)]);
  if (from === null || to === null) {
    throw new Error('COMMIT_NOT_FOUND');
  }
  const paths: string[] = [];
  const pending: PendingTrees[] = [{ prefix: '', fromTree: from.treeHash, toTree: to.treeHash }];
  for (let reads = 0, next = pending.pop(); next !== undefined; next = pending.pop()) {
    reads += 1;
    if (reads > TREE_READS_MAX || paths.length >= CHANGED_FILES_MAX) {
      return { paths: paths.slice(0, CHANGED_FILES_MAX), isTruncated: true };
    }
    const [fromEntries, toEntries] = await Promise.all([
      treeEntries({ repo, hash: next.fromTree }),
      treeEntries({ repo, hash: next.toTree })
    ]);
    const fromByName = new Map(fromEntries.map((entry) => [entry.name, entry]));
    const toByName = new Map(toEntries.map((entry) => [entry.name, entry]));
    for (const name of new Set([...fromByName.keys(), ...toByName.keys()])) {
      const fromEntry = fromByName.get(name);
      const toEntry = toByName.get(name);
      if (fromEntry?.hash === toEntry?.hash) {
        continue;
      }
      const path = `${next.prefix}${name}`;
      const fromTree = fromEntry?.type === 'tree' ? fromEntry.hash : null;
      const toTree = toEntry?.type === 'tree' ? toEntry.hash : null;
      if (fromTree !== null || toTree !== null) {
        pending.push({ prefix: `${path}/`, fromTree, toTree });
      }
      if ((fromEntry !== undefined && fromTree === null) || (toEntry !== undefined && toTree === null)) {
        paths.push(path);
      }
    }
  }
  return { paths: paths.toSorted(), isTruncated: false };
}

type TreeEntriesParams = {
  repo: ArtifactsRepo;
  hash: string | null;
};

async function treeEntries({ repo, hash }: TreeEntriesParams): Promise<ArtifactsTreeEntry[]> {
  if (hash === null) {
    return [];
  }
  const entries = await repo.readTree(hash);
  if (entries === null) {
    throw new Error('TREE_NOT_FOUND');
  }
  return entries;
}
