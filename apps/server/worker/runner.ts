import { DurableObject } from 'cloudflare:workers';

const INACTIVITY_TIMEOUT_MS = 300_000;
const EXEC_TIMEOUT_MS = 120_000;
const CONFLICTS_MAX = 200;
// A conflicted file travels back to a runner in an environment variable, which Linux limits to 128 KiB.
const CONFLICT_FILE_BYTES_MAX = 64_000;
const REGULAR_FILE_MODES = new Set(['100644', '100755']);
const STAGE_LINE = /^stage (\d{6}) [0-9a-f]{40} ([123])\t(.+)$/;
const ERROR_OUTPUT_CHARS_MAX = 500;

// The scripts exit 0 when the job did its work, 1 when a merge check found a conflict, 3 when a git step failed,
// 4 when a repository holds a head other than the one the coordinator recorded, 5 when a landing does not merge,
// and 6 when a push was rejected.
const EXIT_CODE_DONE = 0;
const EXIT_CODE_CONFLICT = 1;
const EXIT_CODE_HEAD_MOVED = 4;
const EXIT_CODE_LAND_CONFLICT = 5;
const EXIT_CODE_PUSH_REJECTED = 6;

export const HEAD_MOVED = 'HEAD_MOVED';
export const LAND_CONFLICT = 'LAND_CONFLICT';
const PUSH_REJECTED = 'PUSH_REJECTED';

// In a file and directory conflict, merge-tree renames the file to <path>~<ref>, with / in the ref written as _.
const RENAMED_SIDE_SUFFIX = /~refs_[a-z0-9_-]+$/;

const PRELUDE = `set -u
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
git init -q || exit 3
git config user.name Commute
git config user.email commute@commute.invalid
url() { printf 'https://commute:%s@%s' "$1" "\${2#https://}"; }
fetch_head() {
  timeout 60 git fetch -q --no-tags "$(url "$1" "$2")" "main:$3" || exit 3
  test "$(git rev-parse "$3")" = "$4" || exit 4
}
`;

// Prints the stage lines of a merge-tree result with conflicts, then each conflicted file with its diff3 markers.
const CONFLICT_REPORT = `report_conflicts() {
  tree=\${1%%$'\\n'*}
  printf '%s\\n' "$1" | tail -n +2 | sed 's/^/stage /'
  printf '%s\\n' "$1" | tail -n +2 | cut -f2 | sort -u | while IFS= read -r path; do
    [ "$(git cat-file -t "$tree:$path" 2>/dev/null)" = blob ] || continue
    [ "$(git cat-file -s "$tree:$path")" -le "$CONFLICT_FILE_BYTES_MAX" ] || continue
    printf 'file %s %s\\n' "$(git cat-file blob "$tree:$path" | base64 -w0)" "$path"
  done
}
`;

// Merges the heads of two changes without a worktree. The right change lands after the left one, so it is the first
// side of the merge, as a change is when it restacks onto trunk.
const MERGE_SCRIPT = `${PRELUDE}${CONFLICT_REPORT}
fetch_head "$LEFT_TOKEN" "$LEFT_REMOTE" refs/left "$LEFT_HEAD"
fetch_head "$RIGHT_TOKEN" "$RIGHT_REMOTE" refs/right "$RIGHT_HEAD"
out=$(timeout 60 git -c merge.conflictStyle=diff3 merge-tree --write-tree --no-messages refs/right refs/left)
status=$?
if [ "$status" -eq 1 ]; then report_conflicts "$out"; exit 1; fi
exit "$status"
`;

// Puts each change on trunk as one commit with a note, then pushes trunk and its notes once. The push succeeds only
// as a fast-forward of the trunk head that the coordinator recorded.
const LAND_SCRIPT = `${PRELUDE}
fetch_head "$TRUNK_TOKEN" "$TRUNK_REMOTE" refs/trunk "$TRUNK_HEAD"
timeout 60 git fetch -q --no-tags "$(url "$TRUNK_TOKEN" "$TRUNK_REMOTE")" refs/notes/commits:refs/notes/commits 2>/dev/null
current=$TRUNK_HEAD
for i in $(seq 1 "$CHANGE_COUNT"); do
  token="C\${i}_TOKEN"; remote="C\${i}_REMOTE"; head="C\${i}_HEAD"; base="C\${i}_BASE"
  message="C\${i}_MESSAGE"; note="C\${i}_NOTE"; author="C\${i}_AUTHOR_NAME"; email="C\${i}_AUTHOR_EMAIL"
  fetch_head "\${!token}" "\${!remote}" "refs/change-$i" "\${!head}"
  out=$(timeout 60 git merge-tree --write-tree --merge-base="\${!base}" "$current" "\${!head}") || exit 5
  commit=$(GIT_AUTHOR_NAME="\${!author}" GIT_AUTHOR_EMAIL="\${!email}" git commit-tree "\${out%%$'\\n'*}" -p "$current" -m "\${!message}") || exit 3
  git notes add -m "\${!note}" "$commit" || exit 3
  echo "landed $i $commit"
  current=$commit
done
timeout 60 git push -q "$(url "$TRUNK_TOKEN" "$TRUNK_REMOTE")" "$current:refs/heads/main" refs/notes/commits:refs/notes/commits || exit 6
echo "trunk $current"
`;

// Brings a change onto the new trunk with a merge commit, so the agent's next git pull is a fast-forward.
const RESTACK_SCRIPT = `${PRELUDE}${CONFLICT_REPORT}
fetch_head "$CHANGE_TOKEN" "$CHANGE_REMOTE" refs/change "$CHANGE_HEAD"
fetch_head "$TRUNK_TOKEN" "$TRUNK_REMOTE" refs/trunk "$TRUNK_HEAD"
if git merge-base --is-ancestor refs/trunk refs/change; then echo "up_to_date $CHANGE_HEAD"; exit 0; fi
if git merge-base --is-ancestor refs/change refs/trunk; then
  timeout 60 git push -q "$(url "$CHANGE_TOKEN" "$CHANGE_REMOTE")" "$TRUNK_HEAD:refs/heads/main" || exit 6
  echo "fast_forward $TRUNK_HEAD"
  exit 0
fi
out=$(timeout 60 git -c merge.conflictStyle=diff3 merge-tree --write-tree --no-messages refs/change refs/trunk)
status=$?
if [ "$status" -eq 1 ]; then report_conflicts "$out"; exit 0; fi
[ "$status" -eq 0 ] || exit 3
commit=$(git commit-tree "\${out%%$'\\n'*}" -p refs/change -p refs/trunk -m "Restack onto trunk \${TRUNK_HEAD:0:12}") || exit 3
timeout 60 git push -q "$(url "$CHANGE_TOKEN" "$CHANGE_REMOTE")" "$commit:refs/heads/main" || exit 6
echo "restacked $commit"
`;

// Merges trunk into a change like a restack, writes the resolved text of each conflicted file into the merged tree,
// and pushes the merge commit.
const RESOLVE_SCRIPT = `${PRELUDE}
fetch_head "$CHANGE_TOKEN" "$CHANGE_REMOTE" refs/change "$CHANGE_HEAD"
fetch_head "$TRUNK_TOKEN" "$TRUNK_REMOTE" refs/trunk "$TRUNK_HEAD"
out=$(timeout 60 git -c merge.conflictStyle=diff3 merge-tree --write-tree --no-messages refs/change refs/trunk)
[ "$?" -eq 1 ] || exit 3
export GIT_INDEX_FILE="$work/index"
git read-tree "\${out%%$'\\n'*}" || exit 3
for i in $(seq 1 "$FILE_COUNT"); do
  path="F\${i}_PATH"; text="F\${i}_TEXT"
  blob=$(printf '%s' "\${!text}" | git hash-object -w --stdin) || exit 3
  mode=$(git ls-files -s -- "\${!path}" | cut -d' ' -f1)
  git update-index --cacheinfo "$mode,$blob,\${!path}" || exit 3
done
tree=$(git write-tree) || exit 3
commit=$(git commit-tree "$tree" -p refs/change -p refs/trunk -m "Restack onto trunk \${TRUNK_HEAD:0:12} and resolve conflicts") || exit 3
timeout 60 git push -q "$(url "$CHANGE_TOKEN" "$CHANGE_REMOTE")" "$commit:refs/heads/main" || exit 6
echo "resolved $commit"
`;

// Checks out a change at its head and runs one check command there. The command does not see the fetch credentials.
const CHECK_SCRIPT = `${PRELUDE}
fetch_head "$CHANGE_TOKEN" "$CHANGE_REMOTE" refs/change "$CHANGE_HEAD"
git checkout -q --detach refs/change || exit 3
unset CHANGE_TOKEN CHANGE_REMOTE
output=$(mktemp)
timeout "$CHECK_TIMEOUT_SECONDS" bash -c "$CHECK_COMMAND" > "$output" 2>&1
status=$?
tail -c "$CHECK_OUTPUT_BYTES" "$output"
rm -f "$output"
printf '\ncommute-check-exit %s\n' "$status"
`;

const CHECK_TIMEOUT_SECONDS = 90;
const CHECK_OUTPUT_BYTES = 2_000;
const CHECK_EXIT_PREFIX = 'commute-check-exit ';

export type RepoHead = {
  remote: string;
  token: string;
  head: string;
};

// A conflicted file whose two sides are both regular text files, with its diff3 markers. The first side is the change
// that lands later.
export type ConflictText = {
  path: string;
  text: string;
};

export type MergeResult = {
  outcome: 'clean' | 'conflict';
  conflicts: string[];
  texts: ConflictText[];
};

export type LandingChange = RepoHead & {
  changeId: string;
  base: string;
  message: string;
  note: string;
  authorName: string;
  authorEmail: string;
};

export type LandPlan = {
  trunk: RepoHead;
  changes: LandingChange[];
};

export type LandResult = {
  trunkHead: string;
  landed: Array<{
    changeId: string;
    commit: string;
  }>;
};

export type RestackPlan = {
  change: RepoHead;
  trunk: RepoHead;
};

// One flat shape, because the RPC types of a Durable Object stub do not carry a union result. A conflict has no head
// commit, and every other outcome has no conflicts.
export type RestackResult = {
  outcome: 'restacked' | 'fast_forward' | 'up_to_date' | 'conflict';
  headCommit: string | null;
  conflicts: string[];
  texts: ConflictText[];
};

export type ResolvePlan = RestackPlan & {
  resolved: ConflictText[];
};

export type CheckRun = {
  exitCode: number;
  output: string;
};

type RunCheckParams = {
  change: RepoHead;
  command: string;
};

type MergeCheckParams = {
  left: RepoHead;
  right: RepoHead;
};

type RunParams = {
  script: string;
  env: Record<string, string>;
  secrets: string[];
};

type ScriptOutput = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

// A runner works on the repositories of one project in a container whose image includes git. The coordinator keeps
// a pool of runners per project and moves a job to the next runner when one fails.
export class Runner extends DurableObject<Env> {
  async mergeCheck({ left, right }: MergeCheckParams): Promise<MergeResult> {
    const output = await this.run({
      script: MERGE_SCRIPT,
      env: { ...sideEnv({ prefix: 'LEFT', side: left }), ...sideEnv({ prefix: 'RIGHT', side: right }) },
      secrets: [left.token, right.token]
    });
    if (output.exitCode !== EXIT_CODE_DONE && output.exitCode !== EXIT_CODE_CONFLICT) {
      throw scriptError(output);
    }
    if (output.exitCode === EXIT_CODE_DONE) {
      return { outcome: 'clean', conflicts: [], texts: [] };
    }
    return { outcome: 'conflict', ...parseConflicts(lines(output.stdout)) };
  }

  async land({ trunk, changes }: LandPlan): Promise<LandResult> {
    const env: Record<string, string> = {
      ...sideEnv({ prefix: 'TRUNK', side: trunk }),
      CHANGE_COUNT: String(changes.length)
    };
    for (const [index, landing] of changes.entries()) {
      const prefix = `C${index + 1}`;
      Object.assign(env, sideEnv({ prefix, side: landing }), {
        [`${prefix}_BASE`]: landing.base,
        [`${prefix}_MESSAGE`]: landing.message,
        [`${prefix}_NOTE`]: landing.note,
        [`${prefix}_AUTHOR_NAME`]: landing.authorName,
        [`${prefix}_AUTHOR_EMAIL`]: landing.authorEmail
      });
    }
    const output = await this.run({
      script: LAND_SCRIPT,
      env,
      secrets: [trunk.token, ...changes.map((landing) => landing.token)]
    });
    if (output.exitCode !== EXIT_CODE_DONE) {
      throw scriptError(output);
    }

    const landed: LandResult['landed'] = [];
    let trunkHead = '';
    for (const line of lines(output.stdout)) {
      const [kind, first, second] = line.split(' ');
      const landing = changes[Number(first) - 1];
      if (kind === 'landed' && landing !== undefined && second !== undefined) {
        landed.push({ changeId: landing.changeId, commit: second });
      } else if (kind === 'trunk' && first !== undefined) {
        trunkHead = first;
      }
    }
    if (trunkHead === '' || landed.length !== changes.length) {
      throw new Error(`The landing script reported ${landed.length} of ${changes.length} changes and no trunk head.`);
    }
    return { trunkHead, landed };
  }

  async restack({ change, trunk }: RestackPlan): Promise<RestackResult> {
    const output = await this.run({
      script: RESTACK_SCRIPT,
      env: { ...sideEnv({ prefix: 'CHANGE', side: change }), ...sideEnv({ prefix: 'TRUNK', side: trunk }) },
      secrets: [change.token, trunk.token]
    });
    if (output.exitCode !== EXIT_CODE_DONE) {
      throw scriptError(output);
    }
    const outputLines = lines(output.stdout);
    if (outputLines.some((line) => line.startsWith('stage '))) {
      return { outcome: 'conflict', headCommit: null, ...parseConflicts(outputLines) };
    }
    const [outcome, headCommit] = outputLines.at(-1)?.split(' ') ?? [];
    if (
      (outcome === 'restacked' || outcome === 'fast_forward' || outcome === 'up_to_date') &&
      headCommit !== undefined
    ) {
      return { outcome, headCommit, conflicts: [], texts: [] };
    }
    throw new Error(`The restack script ended without a result: ${outputLines.at(-1) ?? 'no output'}`);
  }

  // Returns the merge commit that the change now holds.
  async resolve({ change, trunk, resolved }: ResolvePlan): Promise<string> {
    const env: Record<string, string> = {
      ...sideEnv({ prefix: 'CHANGE', side: change }),
      ...sideEnv({ prefix: 'TRUNK', side: trunk }),
      FILE_COUNT: String(resolved.length)
    };
    for (const [index, file] of resolved.entries()) {
      Object.assign(env, { [`F${index + 1}_PATH`]: file.path, [`F${index + 1}_TEXT`]: file.text });
    }
    const output = await this.run({ script: RESOLVE_SCRIPT, env, secrets: [change.token, trunk.token] });
    if (output.exitCode !== EXIT_CODE_DONE) {
      throw scriptError(output);
    }
    const [outcome, headCommit] = lines(output.stdout).at(-1)?.split(' ') ?? [];
    if (outcome !== 'resolved' || headCommit === undefined) {
      throw new Error(`The resolve script ended without a commit: ${outcome ?? 'no output'}`);
    }
    return headCommit;
  }

  async runCheck({ change, command }: RunCheckParams): Promise<CheckRun> {
    const output = await this.run({
      script: CHECK_SCRIPT,
      env: {
        ...sideEnv({ prefix: 'CHANGE', side: change }),
        CHECK_COMMAND: command,
        CHECK_TIMEOUT_SECONDS: String(CHECK_TIMEOUT_SECONDS),
        CHECK_OUTPUT_BYTES: String(CHECK_OUTPUT_BYTES)
      },
      secrets: [change.token]
    });
    if (output.exitCode !== EXIT_CODE_DONE) {
      throw scriptError(output);
    }
    const exitLine = output.stdout.lastIndexOf(CHECK_EXIT_PREFIX);
    if (exitLine === -1) {
      throw new Error('The check script ended without an exit code.');
    }
    return {
      exitCode: Number(output.stdout.slice(exitLine + CHECK_EXIT_PREFIX.length).trim()),
      output: output.stdout.slice(0, exitLine).trimEnd()
    };
  }

  private async run({ script, env, secrets }: RunParams): Promise<ScriptOutput> {
    const container = this.ctx.container;
    if (container === undefined) {
      throw new Error('The Runner class has no container.');
    }
    if (!container.running) {
      container.start({ enableInternet: true });
    }
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    const process = await container.exec(['bash', '-c', script], {
      env: { ...env, CONFLICT_FILE_BYTES_MAX: String(CONFLICT_FILE_BYTES_MAX) },
      signal: AbortSignal.timeout(EXEC_TIMEOUT_MS)
    });
    const output = await process.output();
    const decoder = new TextDecoder();
    return {
      exitCode: output.exitCode,
      stdout: decoder.decode(output.stdout),
      stderr: scrub({ text: decoder.decode(output.stderr), secrets })
    };
  }
}

type SideEnvParams = {
  prefix: string;
  side: RepoHead;
};

function sideEnv({ prefix, side }: SideEnvParams): Record<string, string> {
  return {
    [`${prefix}_REMOTE`]: side.remote,
    [`${prefix}_TOKEN`]: side.token,
    [`${prefix}_HEAD`]: side.head
  };
}

function scriptError(output: ScriptOutput): Error {
  if (output.exitCode === EXIT_CODE_HEAD_MOVED) {
    return new Error(HEAD_MOVED);
  }
  if (output.exitCode === EXIT_CODE_LAND_CONFLICT) {
    return new Error(LAND_CONFLICT);
  }
  if (output.exitCode === EXIT_CODE_PUSH_REJECTED) {
    return new Error(PUSH_REJECTED);
  }
  return new Error(`The runner script exited ${output.exitCode}: ${output.stderr.slice(-ERROR_OUTPUT_CHARS_MAX)}`);
}

function lines(text: string): string[] {
  return text.split('\n').filter((line) => line !== '');
}

type ConflictReport = Pick<MergeResult, 'conflicts' | 'texts'>;

// Reads the report of report_conflicts. A file has text only when both sides hold a regular file, the file fits the
// bound, and its bytes are UTF-8.
function parseConflicts(outputLines: string[]): ConflictReport {
  const stages = new Map<string, Map<string, string>>();
  const encoded = new Map<string, string>();
  for (const line of outputLines) {
    const stage = STAGE_LINE.exec(line);
    if (stage !== null) {
      const [, mode = '', number = '', path = ''] = stage;
      stages.set(path, (stages.get(path) ?? new Map<string, string>()).set(number, mode));
    } else if (line.startsWith('file ')) {
      const [, text = '', ...path] = line.split(' ');
      encoded.set(path.join(' '), text);
    }
  }

  const texts: ConflictText[] = [];
  for (const [path, modes] of stages) {
    const text = encoded.get(path);
    if (
      text !== undefined &&
      REGULAR_FILE_MODES.has(modes.get('2') ?? '') &&
      REGULAR_FILE_MODES.has(modes.get('3') ?? '')
    ) {
      const decoded = decodeUtf8(text);
      if (decoded !== null) {
        texts.push({ path, text: decoded });
      }
    }
  }
  const conflicts = [...new Set([...stages.keys()].map((path) => path.replace(RENAMED_SIDE_SUFFIX, '')))];
  return { conflicts: conflicts.slice(0, CONFLICTS_MAX), texts };
}

function decodeUtf8(base64: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
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
