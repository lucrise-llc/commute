import { DurableObject } from 'cloudflare:workers';

const INACTIVITY_TIMEOUT_MS = 300_000;
const EXEC_TIMEOUT_MS = 120_000;
const CONFLICTS_MAX = 200;
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

// Merges the heads of two changes without a worktree.
const MERGE_SCRIPT = `${PRELUDE}
fetch_head "$LEFT_TOKEN" "$LEFT_REMOTE" refs/left "$LEFT_HEAD"
fetch_head "$RIGHT_TOKEN" "$RIGHT_REMOTE" refs/right "$RIGHT_HEAD"
timeout 60 git merge-tree --write-tree --name-only --no-messages refs/left refs/right
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
const RESTACK_SCRIPT = `${PRELUDE}
fetch_head "$CHANGE_TOKEN" "$CHANGE_REMOTE" refs/change "$CHANGE_HEAD"
fetch_head "$TRUNK_TOKEN" "$TRUNK_REMOTE" refs/trunk "$TRUNK_HEAD"
if git merge-base --is-ancestor refs/trunk refs/change; then echo "up_to_date $CHANGE_HEAD"; exit 0; fi
if git merge-base --is-ancestor refs/change refs/trunk; then
  timeout 60 git push -q "$(url "$CHANGE_TOKEN" "$CHANGE_REMOTE")" "$TRUNK_HEAD:refs/heads/main" || exit 6
  echo "fast_forward $TRUNK_HEAD"
  exit 0
fi
out=$(timeout 60 git merge-tree --write-tree --name-only --no-messages refs/change refs/trunk)
status=$?
if [ "$status" -eq 1 ]; then printf '%s\\n' "$out" | tail -n +2 | sed 's/^/conflict /'; exit 0; fi
[ "$status" -eq 0 ] || exit 3
commit=$(git commit-tree "\${out%%$'\\n'*}" -p refs/change -p refs/trunk -m "Restack onto trunk \${TRUNK_HEAD:0:12}") || exit 3
timeout 60 git push -q "$(url "$CHANGE_TOKEN" "$CHANGE_REMOTE")" "$commit:refs/heads/main" || exit 6
echo "restacked $commit"
`;

export type RepoHead = {
  remote: string;
  token: string;
  head: string;
};

export type MergeResult = {
  outcome: 'clean' | 'conflict';
  conflicts: string[];
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
    const [, ...conflicts] = lines(output.stdout);
    return {
      outcome: output.exitCode === EXIT_CODE_DONE ? 'clean' : 'conflict',
      conflicts: cleanConflicts(conflicts)
    };
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
    const conflicts = outputLines
      .filter((line) => line.startsWith('conflict '))
      .map((line) => line.slice('conflict '.length));
    if (conflicts.length > 0) {
      return { outcome: 'conflict', headCommit: null, conflicts: cleanConflicts(conflicts) };
    }
    const [outcome, headCommit] = outputLines.at(-1)?.split(' ') ?? [];
    if (
      (outcome === 'restacked' || outcome === 'fast_forward' || outcome === 'up_to_date') &&
      headCommit !== undefined
    ) {
      return { outcome, headCommit, conflicts: [] };
    }
    throw new Error(`The restack script ended without a result: ${outputLines.at(-1) ?? 'no output'}`);
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
      env,
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

function cleanConflicts(paths: string[]): string[] {
  return [...new Set(paths.map((path) => path.replace(RENAMED_SIDE_SUFFIX, '')))].slice(0, CONFLICTS_MAX);
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
