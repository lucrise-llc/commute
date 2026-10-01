# P1 results: Commute mechanics with plain git

Decision: can the coordinator rely on `git merge-tree`, subtree object ids,
and conflict-content keys with plain git and no cloud, and what does each cost?

## How to run

From the repository root:

```
bun poc/mechanics/probe.ts <work-dir>
```

The probe owns `<work-dir>`. The directory must not exist, or an earlier run
of the probe must have made it. The probe deletes and recreates it.

Determinism check (runs the probe twice and diffs the outputs):

```
bash poc/mechanics/determinism.sh <output-dir>
```

The output below comes from this exact command:

```
bash poc/mechanics/determinism.sh <output-dir>
```

## Environment

- git: `git version 2.50.1 (Apple Git-155)`. The probe calls the real binary
  (`xcrun -f git`), not the `/usr/bin/git` shim. In a 20-call shell loop
  during setup, the shim took 8.5 ms per call and the real binary 3.3 ms.
- Machine: `arm64` (`uname -m`), macOS (Darwin 25.4.0).
- bun 1.3.14.
- Pinned inputs: author and committer name, email, and date
  (`1790812800 +0000`), `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`,
  `HOME`, `XDG_CONFIG_HOME`, `PATH=/usr/bin:/bin`, `LC_ALL=C`, `TZ=UTC`,
  `GIT_EDITOR=:`, `GIT_ADVICE=0`. No network.
- Every repository is local, under the work dir. Changes are commits on
  their own refs in one bare repository (`forge.git`). Commits are built with
  a temporary index (`read-tree`, `update-index`, `write-tree`,
  `commit-tree`), so C1, C2, C3b, and C4 use no worktree. Only C3a (native
  rerere) uses worktree clones.

## Determinism check

```
lines in each run: 239 and 239
raw diff: 16 changed lines, of which 0 are not TIME lines
diff without TIME lines: empty
```

Every commit id, tree id, result key, rr-cache id, and verdict was the same
in both runs. Only the 8 `TIME` lines differ (8 lines on each side of the
diff).

## Output of one run

This is `run1.txt` from the command above.

```

==============================================================================
SETUP
==============================================================================
git binary        /Applications/Xcode.app/Contents/Developer/usr/bin/git
git version       git version 2.50.1 (Apple Git-155)
machine           arm64
bun version       1.3.14
trunk T0          158dc0cd9b32fda2459178001c8d9384b98f8804  (10 files)
trunk T0 tree     e8438b4ec1bfdae8840984801b2b6fb350c27831

==============================================================================
C1  COMMUTE: merge A then B and B then A with git merge-tree --write-tree
==============================================================================

case 1: disjoint files
  footprint A        packages/api/src/routes.ts
  footprint B        packages/web/src/app.ts
  A then B           clean     exit 0  tree 886a5163dfb6
  B then A           clean     exit 0  tree 886a5163dfb6
  trees equal        yes
  verdict            commute
  pairwise A B       clean     exit 0  tree 886a5163dfb6  agrees with both orders: yes
  pre-filter exact   disjoint -> agree
  pre-filter prefix  disjoint -> agree

case 2: same file, separate hunks
  footprint A        packages/shared/src/util.ts
  footprint B        packages/shared/src/util.ts
  A then B           clean     exit 0  tree af92e7908887
  B then A           clean     exit 0  tree af92e7908887
  trees equal        yes
  verdict            commute
  pairwise A B       clean     exit 0  tree af92e7908887  agrees with both orders: yes
  pre-filter exact   overlap -> disagree (overlap, but merges are clean)
  pre-filter prefix  overlap -> disagree (overlap, but merges are clean)

case 3: same file, same hunk
  footprint A        packages/shared/src/util.ts
  footprint B        packages/shared/src/util.ts
  A then B           CONFLICT  exit 1  paths: packages/shared/src/util.ts
  B then A           CONFLICT  exit 1  paths: packages/shared/src/util.ts
  trees equal        n/a (conflict)
  verdict            conflict
  pairwise A B       CONFLICT  exit 1  paths: packages/shared/src/util.ts  agrees with both orders: yes
  pre-filter exact   overlap -> agree
  pre-filter prefix  overlap -> agree

case 4: migrations 0042_a.sql and 0042_b.sql
  footprint A        db/migrations/0042_a.sql
  footprint B        db/migrations/0042_b.sql
  A then B           clean     exit 0  tree 334f4b56c90a
  B then A           clean     exit 0  tree 334f4b56c90a
  trees equal        yes
  verdict            commute
  pairwise A B       clean     exit 0  tree 334f4b56c90a  agrees with both orders: yes
  pre-filter exact   disjoint -> agree
  pre-filter prefix  disjoint -> agree

case 5: file and directory at one path
  footprint A        packages/web/src/theme
  footprint B        packages/web/src/theme/dark.ts
  A then B           CONFLICT  exit 1  paths: packages/web/src/theme~3eb6c0b37c44e5238176593c09d62e3f33006677
  B then A           CONFLICT  exit 1  paths: packages/web/src/theme~71a1b8d334cddfaaa42e49d5a21e5ea4aa5d3f5d
  trees equal        n/a (conflict)
  verdict            conflict
  pairwise A B       CONFLICT  exit 1  paths: packages/web/src/theme~71a1b8d334cddfaaa42e49d5a21e5ea4aa5d3f5d  agrees with both orders: yes
  pre-filter exact   disjoint -> disagree (disjoint, but merge conflicts)
  pre-filter prefix  overlap -> agree

pre-filter disagreements with merge-tree across the 5 cases:
  exact path sets        false alarms 1, misses 1
  prefix-aware path sets false alarms 1, misses 0
  (a false alarm costs one merge-tree call; a miss skips a merge that conflicts)

==============================================================================
C2  RESULTS KEYED TO CONTENT: key = hash(check, version, object id of each read path)
==============================================================================
checks:
  api-tests         v1  reads packages/api, packages/shared
  web-tests         v1  reads packages/web, packages/shared
  lint              v1  reads eslint.config.json, packages
  migrations-check  v1  reads db/migrations, db/schema.sql
  e2e               v1  reads (root)
restack method: git merge-tree --write-tree <new trunk> <change>, then git commit-tree -p <new trunk>.
  With a single-commit change, the merge base is the old trunk, so the result equals a cherry-pick.

change C touches: packages/web/src/header.ts
object ids from cat-file --batch-check equal git rev-parse <commit>:<path> for every read path: yes

change C on T0, first run (store holds trunk T0 results):
  api-tests         key b508cf0410a0620b  reuse result of trunk T0
  web-tests         key df0b59d5d1273f94  run
  lint              key 3eae9b575dcd5e13  run
  migrations-check  key b03d8e71af81a6fe  reuse result of trunk T0
  e2e               key f22496559a7c1c57  run
TIME  C2 result keys, 5 checks, one change (small repo)          median    4.3 ms  (min 4.1, max 4.3, n=5)

restack C: T0 -> T1   (landing L1 edits packages/api/src/routes.ts)
  api-tests         key b508cf0410a0620b -> 8c62c0c9a072ede5  reuse result of L1
                      subtree packages/api 5d94c8403be3 -> d751baf70cf2
  web-tests         key df0b59d5d1273f94 -> same              keep
  lint              key 3eae9b575dcd5e13 -> 87c910c9084b8070  run
                      subtree packages 5d6f4dafc64b -> 1dd6b579b8c0
  migrations-check  key b03d8e71af81a6fe -> same              keep
  e2e               key f22496559a7c1c57 -> 6debb0f162877298  run
                      subtree (root) 18c30ffa3b00 -> 5bba8b240b3c
  kept 2, key changed 3 (reused from store 1, must run 2)

restack C: T1 -> T2   (landing L2 edits packages/shared/src/util.ts)
  api-tests         key 8c62c0c9a072ede5 -> 2b6c3cf3d28fa7d3  reuse result of L2
                      subtree packages/shared 08eb8ca13d41 -> d6a19b195c9a
  web-tests         key df0b59d5d1273f94 -> 87a99474b6afeefa  run
                      subtree packages/shared 08eb8ca13d41 -> d6a19b195c9a
  lint              key 87c910c9084b8070 -> cfda68f50c006bcb  run
                      subtree packages 1dd6b579b8c0 -> fe49b5d3af8e
  migrations-check  key b03d8e71af81a6fe -> same              keep
  e2e               key 6debb0f162877298 -> f5396ae266eb35c6  run
                      subtree (root) 5bba8b240b3c -> 199c0ac426d2
  kept 1, key changed 4 (reused from store 1, must run 3)

restack C: T2 -> T3   (landing L3 adds db/schema.sql)
  api-tests         key 2b6c3cf3d28fa7d3 -> same              keep
  web-tests         key 87a99474b6afeefa -> same              keep
  lint              key cfda68f50c006bcb -> same              keep
  migrations-check  key b03d8e71af81a6fe -> 8f4eacce27c0c048  reuse result of L3
                      subtree db/schema.sql absent -> 54ce330c5fb0
  e2e               key f5396ae266eb35c6 -> 9668b9bfd2298ff5  run
                      subtree (root) 199c0ac426d2 -> 7c741f3c3f08
  kept 3, key changed 2 (reused from store 1, must run 1)

restack C: T3 -> T4   (landing L4 deletes db/schema.sql)
  api-tests         key 2b6c3cf3d28fa7d3 -> same              keep
  web-tests         key 87a99474b6afeefa -> same              keep
  lint              key cfda68f50c006bcb -> same              keep
  migrations-check  key 8f4eacce27c0c048 -> b03d8e71af81a6fe  reuse result of trunk T0
                      subtree db/schema.sql 54ce330c5fb0 -> absent
  e2e               key 9668b9bfd2298ff5 -> f5396ae266eb35c6  reuse result of C@T2
                      subtree (root) 7c741f3c3f08 -> 199c0ac426d2
  kept 3, key changed 2 (reused from store 2, must run 0)

==============================================================================
C3  RESOLVE ONCE: a conflict resolved for F applies to G without a resolver
==============================================================================
E and F each insert one line after `timeoutMs` in packages/api/src/config.ts.
G makes the same insertion as F and also edits packages/web/src/app.ts.
G2 inserts the same key as F with a different value (negative control).
TE = T0 + E. TEH = TE + H, where H adds 5 comment lines at the top of config.ts.

merge-tree TE F: CONFLICT in packages/api/src/config.ts

-- C3a: native git rerere (rerere.enabled, rerere.autoUpdate) in worktree clones
  sandbox-a: cherry-pick F onto TE
    cherry-pick exit 1, unmerged paths: packages/api/src/config.ts
    rerere: Recorded preimage for 'packages/api/src/config.ts'
    rerere: Recorded resolution for 'packages/api/src/config.ts'.
    resolver wrote the resolution; config.ts blob 6ed9693c150c; matches expected: yes
    rr-cache entries: 0dc5d9301cf00045b56162d37af32c4d66d7de05
  sandbox-a: cherry-pick G onto TE (same sandbox)
    cherry-pick exit 1, unmerged paths: none
    rerere: Staged 'packages/api/src/config.ts' using previous resolution.
  sandbox-a: git merge-tree --write-tree TE G with rr-cache present: exit 1 (conflict reported; rerere not applied)
  sandbox-b (fresh clone, rr-cache copied from sandbox-a): cherry-pick G onto TE
    cherry-pick exit 1, unmerged paths: none
    rerere: Staged 'packages/api/src/config.ts' using previous resolution.
  sandbox-b: cherry-pick G onto TEH (hunk shifted down 5 lines)
    cherry-pick exit 1, unmerged paths: none
    rerere: Staged 'packages/api/src/config.ts' using previous resolution.
  sandbox-c (fresh clone, no rr-cache; control): cherry-pick G onto TE
    cherry-pick exit 1, unmerged paths: packages/api/src/config.ts
    rerere: Recorded preimage for 'packages/api/src/config.ts'

-- C3b: custom resolution key over merge-tree output (no worktree)
key = sha256 of [base, ours, theirs] lines of one diff3 hunk; marker labels, line numbers, and CR are dropped
  F onto TE
    hunk at line 5  key cc27820f4236facd  from resolver
    resolver calls so far 1; config.ts blob 6ed9693c150c; matches expected: yes
  G onto TE
    hunk at line 5  key cc27820f4236facd  from store
    resolver calls so far 1; config.ts blob 6ed9693c150c; matches expected: yes
  G onto TEH (hunk shifted down 5 lines)
    hunk at line 10  key cc27820f4236facd  from store
    resolver calls so far 1; config.ts blob 65a7bc2c7714; matches expected: yes
  G2 onto TE (same place, different value; negative control)
    hunk at line 5  key 3e96901a4c9c8cc9  from resolver

==============================================================================
C4  COST: trunk with 20,000 files in 2,000 leaf directories
==============================================================================
large trunk 7a5fc54875ca7ab16dd21035c62f63ce7e2e3c28: 20001 files, 2101 directories (built with git fast-import)
TIME  C4 build large trunk with fast-import (one run)             204.0 ms
merge-tree X Y (disjoint): clean; merge-tree X Z (same line): CONFLICT in packages/p003/m05/f2.ts
diff-tree footprint of X: packages/p003/m05/f2.ts
result keys via one cat-file process equal keys via one rev-parse per path: yes
TIME  C4 baseline: git rev-parse --verify trunk (process cost)   median    3.1 ms  (min 3.0, max 3.4, n=5)
TIME  C4 merge-tree --write-tree, disjoint pair                  median    3.8 ms  (min 3.7, max 3.9, n=5)
TIME  C4 merge-tree --write-tree, conflicting pair               median    4.3 ms  (min 4.1, max 4.3, n=5)
TIME  C4 diff-tree -r --name-only, one change                    median    3.7 ms  (min 3.6, max 3.9, n=5)
TIME  C4 result keys, 5 checks (one cat-file --batch-check)      median    3.9 ms  (min 3.9, max 4.0, n=5)
TIME  C4 result keys, 5 checks (one rev-parse per path, 8)       median   27.4 ms  (min 26.9, max 28.7, n=5)

==============================================================================
SUMMARY
==============================================================================
expected = the hypothesis under test; match NO = the hypothesis does not hold
claim item                                                    expected                    observed                    match
C1    disjoint files                                          commute                     commute                     yes
C1    same file, separate hunks                               commute                     commute                     yes
C1    same file, same hunk                                    conflict                    conflict                    yes
C1    migrations 0042_a.sql and 0042_b.sql                    commute                     commute                     yes
C1    file and directory at one path                          conflict                    conflict                    yes
C1    one pairwise merge-tree agrees with both orders         yes                         yes                         yes
C1    exact pre-filter safe to skip merge-tree                yes                         no                          NO
C1    prefix-aware pre-filter safe to skip merge-tree         yes                         yes                         yes
C2    cat-file ids equal rev-parse ids                        yes                         yes                         yes
C2    C on T0, first run: must run                            web-tests,lint,e2e          web-tests,lint,e2e          yes
C2    restack onto T1: kept                                   web-tests,migrations-check  web-tests,migrations-check  yes
C2    restack onto T1: must run                               lint,e2e                    lint,e2e                    yes
C2    restack onto T2: kept                                   migrations-check            migrations-check            yes
C2    restack onto T2: must run                               web-tests,lint,e2e          web-tests,lint,e2e          yes
C2    restack onto T3: kept                                   api-tests,web-tests,lint    api-tests,web-tests,lint    yes
C2    restack onto T3: must run                               e2e                         e2e                         yes
C2    restack onto T4: kept                                   api-tests,web-tests,lint    api-tests,web-tests,lint    yes
C2    restack onto T4: must run                               none                        none                        yes
C3    restack F onto TE conflicts                             conflict                    conflict                    yes
C3    rerere: G onto TE, same sandbox, auto-resolved          yes                         yes                         yes
C3    merge-tree applies rerere                               no                          no                          yes
C3    rerere: G onto TE, fresh clone + copied rr-cache        yes                         yes                         yes
C3    rerere: G onto TEH (shifted lines), copied rr-cache     yes                         yes                         yes
C3    rerere control: fresh clone without rr-cache resolves   no                          no                          yes
C3    custom key: G onto TE, resolution source                store                       store                       yes
C3    custom key: resolver calls after F and G                1                           1                           yes
C3    custom key: G result blob equals rerere result blob     yes                         yes                         yes
C3    custom key: G onto TEH (shifted), resolution source     store                       store                       yes
C3    custom key: G2 (different text), resolution source      resolver                    resolver                    yes
C4    large: merge-tree disjoint pair                         clean                       clean                       yes
C4    large: merge-tree conflicting pair                      conflict                    conflict                    yes

31 items, 1 mismatches
```

The one `NO` in the summary is a finding, not a probe error: an exact
path-set pre-filter is not safe (see C1).

## Verdicts

### C1. Commute: PASS

Disjoint files and separate hunks in one file gave one tree in both orders
(`886a5163dfb6`, `af92e7908887`). The same-hunk edit and the file/directory
clash conflicted in both orders, and one pairwise `merge-tree A B` agreed with
both orders in 5 of 5 cases. As expected, `0042_a.sql` and `0042_b.sql`
commute for git (`334f4b56c90a` in both orders), so merge-tree cannot see that
semantic conflict.

Pre-filter: exact path sets disagreed with merge-tree in 2 of 5 cases. One was
a false alarm (separate hunks) and one was a miss (file vs directory), which
would skip a merge that conflicts. Prefix-aware path sets (equal, or one path
is an ancestor of the other) had 1 false alarm and 0 misses.

### C2. Results keyed to content: PASS

Change C touches `packages/web`. The kept and rerun sets matched the
expectation at every restack:

| Restack | Landing | Kept | Key changed | Of those, reused from store | Must run |
|---|---|---|---|---|---|
| T0 to T1 | L1 edits `packages/api` | 2 | 3 | 1 (api-tests, from L1) | 2 (lint, e2e) |
| T1 to T2 | L2 edits `packages/shared` | 1 | 4 | 1 (api-tests, from L2) | 3 (web-tests, lint, e2e) |
| T2 to T3 | L3 adds `db/schema.sql` | 3 | 2 | 1 (migrations-check, from L3) | 1 (e2e) |
| T3 to T4 | L4 deletes `db/schema.sql` | 3 | 2 | 2 (migrations-check, e2e) | 0 |

Restack method: `git merge-tree --write-tree <new trunk> <change>`, then
`git commit-tree -p <new trunk>`. No worktree. For a single-commit change this
equals a cherry-pick. Keys for 5 checks took 4.3 ms per change, from one
`git cat-file --batch-check` process. These ids equal `git rev-parse
<commit>:<path>` for every read path.

Edge cases. The root reader (e2e) got a new key on every restack. At T4 it
still reused a result, because the T4 tree equals the T2 tree. An added path
changes the marker `absent` to an object id. A delete brings back `absent`
and the earlier key, so the T0 result was reused.

### C3. Resolve once: PASS

F's restack onto TE conflicted in `packages/api/src/config.ts`. One resolver
call stored the resolution. G (a different commit with the same edit) took it
from the store with no resolver call. G's `config.ts` blob (`6ed9693c150c`)
equals the expected content and the rerere result. With the hunk shifted from
line 5 to line 10, both rerere and the custom key matched. G2, with different
text at the same place, missed the store (negative control).

Native rerere works in a worktree. It also works from an `rr-cache` copied
into a fresh clone, and the control clone without the copy stays conflicted.
`git merge-tree` does not apply rerere: it returned exit 1 with a matching
`rr-cache` entry present and `rerere.enabled` set.

Choice: the custom key. Because merge-tree ignores rerere, rerere would need
a worktree checkout and a cherry-pick for every conflicting restack, and its
store is a directory in each clone. The custom key reads merge-tree's diff3
output (merge-tree honors `merge.conflictStyle=diff3`), needs no worktree,
and fits a key-value store in the coordinator. The key is the sha256 of the
base, ours, and theirs lines of one hunk, without marker labels, line
numbers, or CR. It gave the same blob as rerere.

### C4. Cost at a realistic size: PASS

Trunk: 20,001 files in 2,101 directories (2,000 leaf directories), built
with `git fast-import` in 204.0 ms. Medians of 5 runs, warm cache, local
disk, one git process per operation:

| Operation | Median |
|---|---|
| Process start baseline (`git rev-parse --verify`) | 3.1 ms |
| `merge-tree --write-tree`, disjoint pair | 3.8 ms |
| `merge-tree --write-tree`, conflicting pair | 4.3 ms |
| `diff-tree -r --name-only`, one change | 3.7 ms |
| Result keys, 5 checks, one `cat-file --batch-check` | 3.9 ms |
| Result keys, 5 checks, one `rev-parse` per path (8 calls) | 27.4 ms |

Process start is most of each cost: each operation takes 0.6 to 1.2 ms more
than the baseline.

## Not tested

- Changes with more than one commit. Restack as one merge equals a
  cherry-pick only for a single commit.
- Renames, and conflicts without text hunks (file/directory,
  modify/delete) in the resolution store. The probe stops on those.
- The custom key with sides swapped (F lands first, then E restacks). The
  key keeps the order of ours and theirs, so it would not match.
- Linux Sandbox containers, cold caches, and Artifacts. All numbers come
  from warm local runs on macOS arm64.

## Implications for the coordinator

- Use `git merge-tree --write-tree` as the commute check. It needs no
  worktree. One pairwise call agreed with both landing orders in 5 of 5
  cases, and it costs about 4 ms on a 20,000-file trunk, of which about 3 ms
  is process start (C1, C4).
- Make the footprint index prefix-aware: two paths meet when they are equal
  or one is an ancestor of the other. Exact path sets missed the
  file/directory conflict (C1 case 5). A hit still needs merge-tree, because
  separate hunks in one file merge cleanly (C1 case 2).
- Keep one result store for the project, keyed by content, not results per
  change. Results from trunk and from landing changes served C after its
  restacks, and at T4 C ran zero checks (C2). Read all subtree ids for a
  commit with one `git cat-file --batch-check` (3.9 ms), not one `rev-parse`
  per path (27.4 ms) (C4).
- Read sets decide reuse. A check that reads `packages` or the root runs
  again after every landing below it (C2, T0 to T1: lint and e2e must run).
  D4's "unrelated landing runs zero checks" holds only if no check reads a
  common ancestor of both changes. Split broad checks per subtree, or accept
  that they run again.
- Store resolutions under the custom hunk key over merge-tree diff3 output,
  not rerere. merge-tree ignores rerere. The custom key matched shifted lines,
  missed changed text, and gave the same blob as rerere (C3).
- A git commute is not a semantic commute: `0042_a.sql` and `0042_b.sql`
  commute for git (C1 case 4). Proposed, not tested: compute result keys on
  the merged batch tree before landing. Its `db/migrations` id differs from
  the id in each change, so migrations-check would run on the batch and could
  catch the duplicate sequence number.
