const TREE_READS_MAX = 2_000;
const FOOTPRINT_PATHS_MAX = 1_000;
const TREE_READS_PER_STEP = 2;
const TREE_ENTRIES_MAX = 20_000;
const CONTROL_CHARACTER = /\p{Cc}/u;

export type MeetingPair = {
  path: string;
  otherPath: string;
};

export function isCanonicalPath(path: string): boolean {
  if (path.startsWith('/') || path.endsWith('/') || CONTROL_CHARACTER.test(path)) {
    return false;
  }
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

// Two paths meet when they are equal or one is a parent directory of the other, so a file and a directory with the
// same name meet, and sibling names that share a prefix do not.
function meets({ path, otherPath }: MeetingPair): boolean {
  return path === otherPath || path.startsWith(`${otherPath}/`) || otherPath.startsWith(`${path}/`);
}

type MeetingPairsParams = {
  paths: string[];
  otherPaths: string[];
};

export function meetingPairs({ paths, otherPaths }: MeetingPairsParams): MeetingPair[] {
  const pairs: MeetingPair[] = [];
  for (const path of paths) {
    for (const otherPath of otherPaths) {
      if (meets({ path, otherPath })) {
        pairs.push({ path, otherPath });
      }
    }
  }
  return pairs.toSorted(comparePairs);
}

function comparePairs(left: MeetingPair, right: MeetingPair): number {
  return left.path.localeCompare(right.path) || left.otherPath.localeCompare(right.otherPath);
}

type DiffParams = {
  repo: ArtifactsRepo;
  fromCommit: string;
  toCommit: string;
  shouldListFolderFiles: boolean;
};

// A side is null when the folder does not exist there.
type PendingTrees = {
  prefix: string;
  fromTree: string | null;
  toTree: string | null;
};

// The paths that differ between two commits. The walk follows only subtrees whose hashes differ. A directory that
// exists on one side only is reported as that directory, or as each of its files when shouldListFolderFiles is set.
export async function diffCommits({
  repo,
  fromCommit,
  toCommit,
  shouldListFolderFiles
}: DiffParams): Promise<string[]> {
  const [from, to] = await Promise.all([repo.readCommit(fromCommit), repo.readCommit(toCommit)]);
  if (from === null || to === null) {
    throw new Error('COMMIT_NOT_FOUND');
  }

  const paths: string[] = [];
  const pending: PendingTrees[] = [{ prefix: '', fromTree: from.treeHash, toTree: to.treeHash }];
  let treeReads = 0;
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    treeReads += TREE_READS_PER_STEP;
    if (treeReads > TREE_READS_MAX) {
      throw new Error('FOOTPRINT_TOO_LARGE');
    }
    const [fromEntries, toEntries] = await Promise.all([
      readEntries({ repo, hash: next.fromTree }),
      readEntries({ repo, hash: next.toTree })
    ]);
    if (fromEntries.length + toEntries.length > TREE_ENTRIES_MAX) {
      throw new Error('FOOTPRINT_TOO_LARGE');
    }
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
      if (fromTree !== null && toTree !== null) {
        pending.push({ prefix: `${path}/`, fromTree, toTree });
      } else if (!shouldListFolderFiles || (fromTree === null && toTree === null)) {
        paths.push(path);
      } else {
        // One side holds a folder, so its files are listed, and so is a file that the other side holds at this path.
        pending.push({ prefix: `${path}/`, fromTree, toTree });
        if ((fromTree === null ? fromEntry : toEntry) !== undefined) {
          paths.push(path);
        }
      }
    }
    if (paths.length > FOOTPRINT_PATHS_MAX) {
      throw new Error('FOOTPRINT_TOO_LARGE');
    }
  }
  return paths.toSorted();
}

type ReadEntriesParams = {
  repo: ArtifactsRepo;
  hash: string | null;
};

async function readEntries({ repo, hash }: ReadEntriesParams): Promise<ArtifactsTreeEntry[]> {
  if (hash === null) {
    return [];
  }
  const entries = await repo.readTree(hash);
  if (entries === null) {
    throw new Error('TREE_NOT_FOUND');
  }
  return entries;
}
