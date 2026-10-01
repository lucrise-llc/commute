# Commute PoC: findings

Date: 2026-10-01. Repository revision: `4606e1c` plus the untracked `poc/` tree.
Cloudflare account: Lucrise S.R.L. Every resource the PoC made has the name
`commute-poc-*` or lives in the Artifacts namespace `commute-poc`.

## Decision this spike informs

Can we build the demo scope in `PRD.md` on Artifacts, Durable Objects, and
containers as designed? Which parts need a different design?

**Answer: yes, with two design changes.** Every risk in the PRD table "Risks
to settle first" has an answer below. No result blocks the build.

1. Push events come from a git proxy Worker, not from Artifacts event
   subscriptions.
2. The container image must already contain git. Installing git at boot
   takes 10 to 36 seconds.

## Results

| Probe | Question | Result |
|---|---|---|
| P0 | Is Artifacts enabled on the account? | Yes. The REST API created repo `trunk` in 3.6 s. |
| P1 | Do the three mechanics hold with plain git? | Yes. Details in `mechanics/RESULTS.md`. |
| P2 | Fork time, tokens, notes, tree reads | A fork takes 2.6 to 4.5 s. Five concurrent forks of one repo finish in 5 s. |
| P3 | How does the coordinator learn about a push? | The git proxy is faster and needs no setup per change. Details below. |
| P4 | Can a container run git, merges, and a check? | Yes, if the image or a snapshot already contains git. |

### P1. Mechanics with plain git (local, no cloud)

Source: `poc/mechanics/RESULTS.md`. Command: `bun poc/mechanics/probe.ts <work-dir>`.
Two runs printed identical hashes. A second agent reran the probe and got the
same verdicts.

- **Commute check.** One `git merge-tree --write-tree A B` call gives the same
  verdict as both landing orders. It needs no worktree. It takes about 4 ms on
  a trunk of 20,000 files, and most of that time is process start.
- **Pre-filter.** A comparison of exact path sets is not safe. It missed a
  conflict between a file and a directory at one path. A prefix-aware
  comparison (a path also matches its parent directories) had no misses.
- **Result keys.** Subtree object ids work as keys. All keys for 5 checks take
  about 4.5 ms with one `git cat-file --batch-check` process. A check that
  reads a broad path (for example `packages` or the repository root) runs again
  after every landing under that path.
- **Result store.** One store for the whole project reuses results across
  changes, not only across restacks of one change.
- **Stored resolutions.** `git merge-tree` does not use rerere. A custom key,
  the hash of the conflict hunk (base, ours, theirs), works without a worktree.
  The key still matched when the hunk moved from line 5 to line 10.
- **Known limit.** Two migrations with the same number in different files
  (`0042_a.sql`, `0042_b.sql`) merge cleanly, so the check calls them
  commuting.

### P2. Artifacts

Code: `poc/probe/` (Worker `commute-poc-probe` and `drive.ts`). Records:
`poc/probe/records/`.

| Measure | Value |
|---|---|
| Fork from trunk, one at a time | 2.8 s (all branches), 4.5 s (default branch only) |
| Five forks of trunk at the same time | 2.6 to 3.2 s each, 5 s wall time |
| Time from fork return to repo ready | One poll, 29 to 66 ms |
| Clone of a fork from a laptop | 1.6 s |
| Push of one small commit | Median 1.25 s, maximum 2.1 s, 35 pushes |

- `readTree()` returns the hash of each child, and the hashes equal local git.
  The Worker computed a footprint with 8 tree reads in 142 ms. The result
  matched `git diff --name-only`. The coordinator does not need a container to
  compute footprints.
- Git notes in `refs/notes/commits` reach the server on push. A fork copies
  them, also with `defaultBranchOnly: true`. The binding method `log()` does
  not resolve the notes ref; it returns an empty list.
- Write tokens work over the git proxy and directly. The PoC passed each token
  to git through a credential helper that reads a file with mode 600.

### P3. Push events

| Path | Setup per change | Delay after `git push` returns | Lost events |
|---|---|---|---|
| Git proxy Worker in front of Artifacts | None | The event arrived 5 to 14 ms before `git push` returned (5 of 5) | None |
| Artifacts event subscription, Queue, consumer Worker | One REST call per change repo | Median 1.0 s, p90 5.3 s, maximum 7.4 s (27 pushes) | Pushes in the first 4.5 to 7.7 s after the subscription was created |

- Push events exist only at repository level. The account-level source
  `artifacts` sends create, delete, fork, and import events, not pushes. Each
  change repo needs its own subscription.
- Wrangler 4.146 has no option to select a repository for an `artifacts.repo`
  subscription. The REST API accepts `source.namespace` and `source.repo_name`.
- Artifacts writes the event about 170 ms after the push (median). Most of
  the delay comes from Queue delivery.

### P4. Containers

Code: `poc/sandbox/` (Worker `commute-poc-sandbox`). It uses the Durable Object
container API with the managed image `cloudflare/debian-trixie`.

| Measure | Value |
|---|---|
| Cold boot to first command, managed image | 84 to 97 ms |
| Image contents | Node 24, 1 vCPU, 2.1 GB disk, no git |
| `apt-get install git` | 9.6 s, 25.2 s, 36.2 s |
| Cold boot from a snapshot with git | 0.56 s and 3.85 s |
| Clone trunk from Artifacts | 0.6 to 1.5 s |
| Fetch two change repos | 1.1 to 2.4 s |
| `merge-tree` in both orders | 10 to 19 ms each, same tree both times |
| Small check (Node parses 11 files) | 0.6 to 2.3 s |
| Whole merge probe | Warm 5.4 s; cold from snapshot 6.9 to 9.8 s |

One container id (`runner-3`) failed three times in four minutes with "The
container connection is temporarily unavailable, try again shortly". Each
attempt took 51 to 84 s. Other ids worked before and after. We do not know the
cause.

## Decisions

The user ratified decisions 1 and 2 on 2026-10-01. Decisions 3 to 7 are in
`PRD.md` and are provisional until that change is reviewed. Decision 8 is an
implementation choice.

1. **Git proxy for push events.** Agents push to a Commute remote. A Worker
   forwards git traffic to Artifacts and tells the coordinator about each push.
   Reason: no setup per change, no lost first pushes, and an event before
   `git push` returns. The proxy is also the place for Commute's own auth.
2. **Footprints in the Worker.** The coordinator walks trees with `readTree()`.
   Merges and checks stay in containers.
3. **Prefix-aware footprint index.** A path matches its parent directories.
   A match leads to `merge-tree`, never to a verdict alone.
4. **One result store per project,** keyed by check name, check version, and
   subtree object ids.
5. **Own resolution key,** not rerere: the hash of the conflict hunk.
6. **Git in the image.** The baseline image contains git. Snapshots hold
   warm dependency caches per project. The PoC tested snapshots, not a custom
   image.
7. **A pool of container runners.** The coordinator sends a job to another
   runner when one fails.
8. **Durable Object container API without the Sandbox SDK package.** The
   current Sandbox docs use it, and the PoC needed nothing more.

## Run the probes

The probes need Bun, Git, and Wrangler 4.146 or later. Set these variables:

- `COMMUTE_POC_DIR`: a private directory. The file `secrets/probe-key` in it
  holds the probe key, which is also the `PROBE_KEY` secret of both Workers.
- `COMMUTE_PROBE_URL` and `COMMUTE_SANDBOX_URL`: the workers.dev URLs of the
  two Workers.

Commands:

1. `bun poc/mechanics/probe.ts <work-dir>` runs P1.
2. `bun drive.ts seed`, then `bun drive.ts fork <name>`, in `poc/probe/`.
3. `bun drive.ts listen 900` in one shell and `bun drive.ts push <repo> proxy`
   in another, then `bun drive.ts latency`.
4. `bun drive.ts merge <runner> c1 c2 [snapshot-id]` in `poc/sandbox/`.

## What the spike did not test

- The account limit on event subscriptions. Decision 1 removes the need.
- One coordinator with 100,000 changes in flight (D9).
- `interceptOutboundHttp`, which keeps tokens out of the container. The PoC
  put a read token with a 10-minute life in the container.
- Large pushes through the proxy. The probe reads the whole push body, up to
  50 MB.
- Changes with more than one commit, renames, and a resolution key with the
  sides swapped.
- Container concurrency limits and cost.
- A custom image with git, built with Docker.

## Cost the production version carries

- The proxy carries all git traffic. It must stream push bodies and read the
  ref commands without a full buffer.
- Agents use a Commute remote and Commute tokens, not Artifacts remotes.
- A check that reads a broad path loses the "zero checks after an unrelated
  landing" claim in D4. The demo repository needs checks with narrow read sets.
- Semantic conflicts, such as migration numbers, need a check on the merged
  batch tree before landing.
- Runner failover and retries.

## Cloud resources the PoC made

Nothing existing was changed or deleted.

- Workers `commute-poc-probe` and `commute-poc-sandbox` on workers.dev, each
  with a `PROBE_KEY` secret.
- Durable Object classes `Hub` and `Runner`, and the container application
  for `Runner`.
- Queue `commute-poc-events` and event subscription `commute-poc-c2-pushed`.
- Artifacts namespace `commute-poc` with repos `trunk` and `c1` to `c7`.
- Container snapshot `3b5f49e1-03f9-42d1-8eaa-45d309d9f2e1` (30-day life,
  renewed on restore).
