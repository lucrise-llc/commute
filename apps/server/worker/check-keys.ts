import type { CheckDeclaration } from './project-file';

import { sha256Hex } from './hash';
import { CHECKS_INVALID, REPOSITORY_ROOT } from './project-file';

// The hash a read path gets when the commit has nothing at that path.
const ABSENT = 'absent';
const TREE_READS_MAX = 500;

type SubtreeHashesParams = {
  repo: ArtifactsRepo;
  commit: string;
  paths: string[];
};

// The object hash at each path of a commit: the tree of a directory, the blob of a file, or "absent". The walk reads
// each tree once and follows only the segments of the paths.
export async function subtreeHashes({ repo, commit, paths }: SubtreeHashesParams): Promise<Record<string, string>> {
  const metadata = await repo.readCommit(commit);
  if (metadata === null) {
    throw new Error('COMMIT_NOT_FOUND');
  }
  const trees = new Map<string, ArtifactsTreeEntry[]>();
  const readTree = async (hash: string): Promise<ArtifactsTreeEntry[]> => {
    const cached = trees.get(hash);
    if (cached !== undefined) {
      return cached;
    }
    if (trees.size >= TREE_READS_MAX) {
      throw new Error(CHECKS_INVALID, {
        cause: new Error(`The checks read more than ${TREE_READS_MAX} trees. Declare narrower read paths.`)
      });
    }
    const entries = await repo.readTree(hash);
    if (entries === null) {
      throw new Error('TREE_NOT_FOUND');
    }
    trees.set(hash, entries);
    return entries;
  };

  const hashes: Record<string, string> = {};
  for (const path of paths) {
    hashes[path] =
      path === REPOSITORY_ROOT ? metadata.treeHash : await hashAtPath({ readTree, root: metadata.treeHash, path });
  }
  return hashes;
}

type HashAtPathParams = {
  readTree: (hash: string) => Promise<ArtifactsTreeEntry[]>;
  root: string;
  path: string;
};

async function hashAtPath({ readTree, root, path }: HashAtPathParams): Promise<string> {
  let hash = root;
  let isTree = true;
  for (const segment of path.split('/')) {
    if (!isTree) {
      return ABSENT;
    }
    const entry = (await readTree(hash)).find((candidate) => candidate.name === segment);
    if (entry === undefined) {
      return ABSENT;
    }
    hash = entry.hash;
    isTree = entry.type === 'tree';
  }
  return hash;
}

type ResultKeyParams = {
  check: CheckDeclaration;
  hashes: Record<string, string>;
};

// A result belongs to the check as declared and to the content it reads. Two heads that agree on both share it.
export async function resultKey({ check, hashes }: ResultKeyParams): Promise<string> {
  const reads = Object.entries(hashes).toSorted(([left], [right]) => left.localeCompare(right));
  return sha256Hex(JSON.stringify([check.name, check.version, check.command, reads]));
}
