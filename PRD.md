# Commute: product requirements

Status: draft, October 1, 2026. "Commute" is a working name.

## Summary

Commute is a forge for many agents that work on one codebase at the same time.
Each change gets its own repository. A coordinator watches every change in
flight. It tells agents at the start when their work overlaps. It lands
independent changes in any order, and those changes keep their check results.

The name comes from the core rule: changes that commute land in any order.

This document has two parts. The demo scope is what we build and show by
October 14, 2026. The post-demo features are the rest of the product.

## Background

We analyzed three months of agent work on a production monorepo. Agents wrote
most of the code, and people approved what landed. The analysis found four
things:

- **Conflicts are cheap.** Agents resolve a textual merge conflict in about a
  minute.
- **Waiting is expensive.** Changes in a stack wait for the whole stack. A
  stacked change takes many times longer to land than an independent change.
- **A rebase throws away results.** Check results, reviews, and evidence attach
  to a commit hash. A rebase gives every change above it a new hash, so all of
  that work runs again, even when the change itself did not move.
- **Agents poll.** Agents learn about check results and review results by
  asking again and again, because nothing tells them when a result is ready.

Two more problems came up often:

- Agents that share one checkout or one set of refs damage each other's work.
- No agent can see what other agents are doing. A person passes that news
  between them.

## Goals

- Let independent changes land in any order without the need to run their checks
  again.
- Tell an agent at the start of its work whether it overlaps another change in
  flight.
- Decide by default whether two changes run in parallel or one after the other.
- Give each agent an isolated repository in seconds.
- Tell agents what happened through events, so that no agent polls.
- Give the operator one screen for the whole fleet and one approval per landing
  batch.
- Let several people run agents on one project without any person passing
  overlap news to another person.

## Non-goals for the demo

- Code review by people inside the product.
- Organizations, roles, and permissions beyond one token per change and one
  owner per change.
- Issues, code search, and project planning.
- Import from or sync with other Git hosts.

## Users

| User | Need |
|---|---|
| Implementer agent | A repository in seconds. Early news of overlaps. A clear signal when its change is ready or blocked. |
| Resolver agent | The conflicting hunk and the intent of both changes. |
| Operator (a person) | One view of the fleet. One decision per landing batch. Trust that every result names the content it checked. |
| Team member (a person who runs agents) | A view of their own changes. News only when a decision needs them. No need to tell other people about overlaps. |

## Concepts

| Term | Meaning |
|---|---|
| Change | One unit of work with an intent. It lives in its own Artifacts repository, forked from trunk. |
| Intent | One or two sentences that say what the change is for. The agent writes it at the start. It is stored as a git note. |
| Owner | The person who started the change. It is stored with the change and as a git note. |
| Footprint | The paths that a change touches. The agent declares them at the start. The coordinator measures them from tree diffs on every push. |
| Trunk | The repository that changes land on. Only a landing writes to trunk. |
| Overlap | Two changes in flight whose footprints meet. A path meets the same path and each of its parent directories. |
| Sequence | An order that the coordinator sets between two changes that collide. |
| Commute | Two changes commute when they merge cleanly in either order. |
| Result | The outcome of a check. Its key is the hash of each subtree that the check reads, plus the version of the check. |
| Resolution | How a conflict was resolved. Its key is the hash of the conflict hunk: its base, ours, and theirs lines. |
| Landing batch | A set of changes that commute with each other and with trunk. A person approves the batch. |
| Coordinator | One per project. It holds the footprint index, the sequences, the result keys, and the landing queue. It sends every event. |
| Commute remote | The Git address of a change. A Worker forwards Git traffic to the Artifacts repository of the change and tells the coordinator about each push. |
| Runner | A container that runs merges, checks, and the resolver agent. Its image includes Git. |
| Event | A message from the coordinator: overlap found, check done, restacked, resolved, or landed. |

## Principles

- **The change is the unit.** A change has an intent, a footprint, results, and
  context. Branches and pull requests are not part of the model.
- **Parallel by default.** Two changes wait for each other only when their
  footprints overlap and a real merge shows a conflict.
- **Results follow content.** A check result is valid while the subtrees it reads
  keep the same hash. A restack keeps every result whose key did not change.
- **Context travels with the change.** Intent, decisions, and evidence ride on
  commits as git notes.
- **Plain git in, events out.** Agents clone, commit, and push. The forge tells
  them what happened next.
- **People decide at the boundary.** A person approves what lands on trunk.
  Agents do everything before that.

## Demo scope (MVP)

The demo must show three claims working for real:

1. Changes that commute land in any order.
2. A check result survives a restack when the subtrees it reads did not change.
3. Overlaps are known at the start of the work, and conflicts are resolved with
   the intent of both changes.

The demo also shows a team. Two people run agents on one project, and neither
person passes overlap news to the other.

### Requirements

#### D1. One repository per change

`commute start` forks trunk into a new Artifacts repository for the change.

- The command takes an intent and a list of paths (`--paths`).
- The response has the change ID, the Commute remote of the change, and a write
  token that expires in 60 minutes.
- The agent uses plain `git clone`, `git commit`, and `git push`.
- The intent is stored as a git note on the first commit.

Acceptance: an agent goes from `commute start` to its first push with standard
Git only. Two agents in parallel never share refs, stash, or index.

#### D2. Coordinator and overlap check

A Durable Object per project learns about every push from the Commute remote.

- The Commute remote forwards each push to Artifacts. When Artifacts accepts the
  push, the remote sends the ref updates to the coordinator.
- On each push, the coordinator computes the changed paths. It reads the trees
  of both commits through the Artifacts Workers binding and follows only the
  subtrees whose hashes differ. This step needs no container.
- It updates the footprint index. A path in the index meets the same path and
  each of its parent directories, so a file in one change and a directory with
  the same name in another change overlap.
- For each change in flight whose footprint meets the new footprint, it runs
  `git merge-tree --write-tree` on the pair in a runner. One merge of the pair
  gives the same result as both landing orders. A meeting footprint alone never
  sets a sequence.
- If the merge is clean, both changes stay parallel. If the merge has a
  conflict, the coordinator sets a sequence.
- At `commute start`, the coordinator checks the declared paths against the
  index and reports overlaps before the agent writes code.

Acceptance: a pair of changes that touch the same file without a conflict stays
parallel. A pair with a conflict gets a sequence, and both agents receive the
intent of the other change. A change that adds a file and a change that adds a
directory at the same path get a sequence.

#### D3. Events and `commute wait`

- The coordinator sends events over a WebSocket: overlap found, check done,
  restacked, resolved, landed.
- Push events come from the Commute remote, so the coordinator knows about a
  push before `git push` returns.
- `commute wait` blocks until the next event for the change arrives, then
  prints it.

Acceptance: no agent and no console view polls for status during the demo.

#### D4. Checks keyed to content

- A project file declares each check: its name, its command, and the paths it
  reads.
- Checks run in runners.
- The key of a result is the hash of each subtree that the check reads, plus the
  check version.
- One result store holds the results of every change in the project. A change
  reuses a result that another change produced under the same key.
- Each check declares the narrowest paths that it reads. A check that reads the
  repository root runs again after every landing.
- After a restack, the coordinator keeps every result whose key did not change.
  Only the other checks run again.
- The console shows, for each check, the subtree hash before and after the
  restack, and whether the result was kept.

Acceptance: a change restacks after an unrelated landing and runs zero checks.
A change restacks after a landing that touched one of its subtrees and runs
only the checks that read that subtree.

#### D5. Landing batches

- The coordinator groups ready changes that commute with each other and with
  trunk into a batch.
- The operator approves the batch with one action.
- Each change lands on trunk as one commit, with its notes attached.
- The order inside a batch does not matter.

Acceptance: a batch of four or more changes lands after one approval, and no
check runs again for a change whose subtrees did not move.

#### D6. Resolver agent

- When a restack produces a conflict, the coordinator starts a resolver agent
  in a runner.
- The resolver receives the conflicting hunk and the intent and notes of both
  changes.
- The resolver commits a resolution. The checks for the affected subtrees run
  on the result.
- The coordinator stores the resolution. Its key is the hash of the conflict
  hunk: its base, ours, and theirs lines, read from the `git merge-tree` output.
  When the same conflict occurs again, the stored resolution applies and the
  resolver does not run. Git rerere is not used, because `git merge-tree` does
  not apply it.

Acceptance: a conflict between two changes is resolved without a person, the
checks pass, and a second change that hits the same conflict reuses the stored
resolution.

#### D7. Console: code, changes, the change page, and the overlap page

The console uses the page structure that people know from Git hosts, so nobody
learns a new layout. Commute's ideas appear in the places where people expect
a merge button, check results, or a timeline. A change is not called a pull
request, because each change is its own repository.

- **Code** shows trunk at its last landing: the file tree, a file view, the
  README, and the commit history. Each folder shows the changes in flight that
  touch it. A selector switches between trunk and the repository of any change.
- **Changes** lists every change: in flight, landed, and closed. Each row shows
  the intent, the owner, the agent, the state, the checks kept and run, and what
  the change waits for. A side panel shows the ready batch with its approval
  action, the overlaps, and the event feed.
- **Change page** has four tabs:
  - Activity: the intent as the description, then a timeline of
    coordinator events (push, overlap, sequence, restack, resolution, landing).
    An overlap event links to the overlap page.
  - Commits: the commits of the change since its base on trunk.
  - Checks: each check with its result, whether it was kept or ran, and the
    subtree hashes before and after the last restack.
  - Files: the diff of the change against its current base on trunk.
- A **landing box** at the end of the change page shows whether the change
  commutes with the changes in flight, what it waits for, whether its results
  match its current content, and its landing batch with the approval action.
  The page has no action to update the base, because the coordinator restacks.
- The **overlap page**, linked from the change pages of both changes, shows the
  two changes side by side with their intents and footprints, the conflicting
  hunk, the resolution with both intents, and the checks after the restack.
- The console reads files, trees, and commits through the Artifacts Workers
  binding. It gets the head of each ref from the coordinator, because the
  binding cannot list refs or resolve the notes ref.
- Pages update from the WebSocket of the coordinator. No page polls.
- The console has its own visual style: a light theme with its own mark and
  icons. It copies the page structure, not the branding of another product.
  Colors come from CSS variables, so a dark theme needs no redesign.

Acceptance: a person who knows a common Git host browses trunk, opens a change,
reads its diff, sees why it waits, and approves its batch without help. The
operator follows the whole demo from the Changes list, the change page, and the
overlap page.

#### D8. CLI

- `commute start "<intent>" --paths <paths>`
- `commute wait`

Acceptance: an agent needs only these two commands plus Git.

#### D9. Scale benchmark

- A load test puts 100,000 synthetic changes in flight against one coordinator.
- It measures the overlap lookup time and the landings per minute.
- Real Artifacts repositories are used only for the agents in the demo.

Acceptance: the demo shows measured numbers and names the limit of a single
coordinator.

#### D10. Demo harness

- Two people each run 10 agents on a public demo repository at the same time.
- A script starts the agents and replays the run so that the demo is
  repeatable.

Acceptance: the script produces the same overlaps, sequences, conflict, and
landings on every run.

#### D11. Team layer

- `commute start` records the owner of the change. The owner comes from
  `--as <name>` or from the name in the CLI config.
- The coordinator stores the owner with the change. The git note on the first
  commit includes the owner.
- The Changes list shows the owner of each change and has a "Mine" filter.
- The console runs behind Cloudflare Access. The console uses the email that
  Access gives for the person who signed in.
- Any team member can approve a landing batch. The notes on each landed commit
  record who approved the batch.

Acceptance: two people run agents on one project. An overlap between their
changes is sequenced and resolved, and neither person sends a message to the
other. Each landed commit names its owner and its approver.

### If time allows

These items are not required for the demo. Build them in this order if the
required items are done early.

1. A reviewer agent that receives each push as an event. Its findings are
   records with a key on the patch, so they survive a restack when the patch
   did not change.
2. Overlap prediction from the intent alone, so that `--paths` becomes optional.
3. An MCP server over the CLI commands.

### Demo storyline (about 8 minutes)

| Minutes | Beat | What the viewer sees |
|---|---|---|
| 1 | Why | The problem in numbers: conflicts are cheap, waiting and lost results are expensive. |
| 1.5 | Start | Alice and Bob each start 10 agents. Overlaps show up at the start. Most changes run in parallel. Two pairs are sequenced, and one pair crosses from Alice to Bob. |
| 1.5 | Land | Bob approves a batch that has changes from both people. Its changes land in any order. A counter shows the checks kept. |
| 2 | Conflict | Alice's change lands. Bob's change restacks onto the new trunk and conflicts. The resolver uses both intents and stores the resolution. Neither person acts. A later change hits the same conflict, and the stored resolution applies. |
| 1 | Scale | The benchmark: 100,000 changes in flight, with measured lookup time and landing rate. |
| 1 | Agent view | The CLI: `commute start`, plain Git, `commute wait`. |

### Measures

- Time from push to landed, for changes that commute.
- Share of check results kept after a restack.
- Overlaps found at the start against overlaps found at landing.
- Operator decisions per 100 changes.
- Messages between people about overlaps. The target is zero.
- Overlap lookup time with 100,000 changes in flight.

### Architecture

| Part | Cloudflare product |
|---|---|
| API, console, and the Commute remote | Workers |
| Trunk and one repository per change | Artifacts |
| Coordinator, one per project | Durable Objects |
| Runners for merges, checks, and the resolver agent | Containers, from an image that includes Git |
| Push events | The Commute remote, after Artifacts accepts the push |
| Console sign-in | Cloudflare Access |

Commute does not use Artifacts event subscriptions for pushes. A push
subscription covers one repository, so each change needs its own. In the PoC, a
new subscription missed every push in its first 4.5 seconds and delivered its
first event for a push 7.7 seconds after it was created. Its events arrived up
to 7.4 seconds after the push. The event from the Commute remote arrived before
`git push` returned. The data is in
[poc/FINDINGS.md](poc/FINDINGS.md).

The coordinator keeps a pool of runners. When a runner does not answer, the
coordinator sends the job to another runner.

The flow for one change:

1. The agent runs `commute start`. The API forks trunk and returns the Commute
   remote and a token.
2. The coordinator checks the declared paths against the footprint index.
3. The agent pushes to the Commute remote. The remote forwards the push to
   Artifacts and then tells the coordinator.
4. The coordinator updates the footprint from tree reads and runs merge checks
   in a runner for overlapping pairs.
5. The coordinator runs the checks whose keys changed.
6. The change joins a landing batch. The operator approves the batch.
7. Changes in the batch land on trunk. The coordinator restacks every affected
   change and starts the resolver for each conflict.

### Risks settled on October 1

The PoC in [poc/](poc/) measured each risk. [poc/FINDINGS.md](poc/FINDINGS.md)
has the data and the commands.

| Risk | Result | Consequence |
|---|---|---|
| Account | Artifacts is enabled on the account. | None. |
| Containers | The managed image boots in under 0.1 s but has no Git. Installing Git takes 10 to 36 s. A snapshot with Git boots in 0.6 to 3.9 s. `git merge-tree` takes 10 to 19 ms. One container id stopped answering. | Runners use an image that includes Git. The coordinator keeps a pool of runners. |
| Artifacts | A fork takes 2.6 to 4.5 s, and five forks at once take 5 s. Tree reads return the hash of each child. Forks keep git notes. | The coordinator computes footprints without a container. |
| Push events | Event subscriptions cover one repository each and arrive 0.3 to 7.4 s after a push. The Commute remote event arrives before `git push` returns. | Push events come from the Commute remote. |

### Open risks

| Risk | What we measure | Fallback |
|---|---|---|
| One coordinator with 100,000 changes in flight | Overlap lookup time and landings per minute (D9) | Split the footprint index by top-level path |
| Large pushes through the Commute remote | Push time for a large pack, with the body streamed | A size limit for pushes in the demo |
| Runner image with Git | Build time and cold start of a custom image | A snapshot with Git |

### Schedule

| Dates | Work |
|---|---|
| October 1 to 2 | Open decisions and the open risks above |
| October 3 to 6 | D1, D2, D3, D8 |
| October 7 to 9 | D4, D5, and the Code view of D7 |
| October 10 to 11 | D6, the Changes list and the change page of D7, D11 |
| October 12 | D9, D10, and a full rehearsal |
| October 13 | Record the video, write the README run steps and the LICENSE, submit |
| October 14 | Spare day. Submissions close at 11:59 PM PDT. |

## Post-demo features

These features complete the product. They are not part of the demo.

### Changes and stacks

- **Restack ahead of landing.** Restack a sequenced change onto the change
  ahead of it before that change lands, so it can join the next batch at once.
- **Stack as one gate.** Run the checks for a stack once, on the top change.
  Show each layer as an interdiff for review. Land the whole stack atomically.
- **Semantic conflict rules.** Detect conflicts that Git cannot see, such as two
  database migrations in the wrong order, a generated file, or a lockfile. One
  approach: before a batch lands, run the checks whose keys change on the
  merged tree of the batch.
- **Operator overrides.** Let the operator swap the order of a sequence or ask
  two agents to split a shared file.
- **Shared resolution memory.** Share stored resolutions across projects that
  use the same code.

### Review

- **Reviewer agents.** A reviewer receives each push as an event.
- **Findings as records.** Each finding has a severity, an anchor, a state, and
  the commit that fixed it. Its key is the patch, so it survives a restack.
- **Review summary for people.** The operator reads one summary per change and
  decides.

### Context and evidence

- **Evidence store.** Each change gets a versioned store for check output,
  screenshots, videos, and transcripts. The store links to commits and stays out
  of the code tree.
- **Provenance.** Each commit records the agent, the model, the operator, and
  the session as git notes.
- **Context for new agents.** An agent that joins a change receives its intent,
  decisions, and evidence in one call.

### Agents and coordination

- **Overlap prediction.** Predict the footprint from the intent and the code it
  names, so declared paths become optional.
- **MCP server.** Expose `start`, `wait`, `context`, and `note` as MCP tools.
- **Agent identity.** Each session has its own identity and a Commute token
  with the least access it needs. The Commute remote checks the Commute token
  and holds the Artifacts token.
- **Fleet presence.** Show which files each agent is working on now and what it
  waits for.
- **Notifications for people.** Send a message to a person only when a decision
  needs a person.

### Console

- Changes since the last review on the change page, after a restack.
- Comments on lines of the diff, from people and reviewer agents.
- Landing page: next batch, batches that form, landing history.
- Trunk history with the batch and the resolution behind each commit.
- Search across changes, intents, and paths.
- A dark theme.

### Scale and platform

- **Sharded coordinator.** Split the footprint index by top-level path across
  several Durable Objects, so one project can hold hundreds of thousands of
  changes in flight.
- **Fast workspaces.** Mount large repositories with ArtifactFS. Start each
  agent from a cached dependency snapshot.
- **Check runners.** Run heavier check suites, including suites that need
  databases and other services.
- **No tokens in runners.** The coordinator adds the Artifacts credentials to
  the Git traffic of a runner at the network boundary, so runners hold no
  tokens.
- **Data location.** Let a project choose the jurisdiction of its repositories.

### Teams

- **Organizations and roles.** People belong to an organization. Roles control
  who can start changes, approve batches, and change settings.
- **Owners by path.** A team assigns owners to paths. A change that touches an
  owned path needs that owner's approval before it can land.
- **Owner sign-off.** A change is ready only after its owner signs off. Batches
  then land on one approval from the person on duty, or with no approval when
  the team allows it.
- **Review by a second person.** A team can require a second person to approve
  a change, based on its paths or its size.
- **Notifications.** Send a message in Slack or by email to the owner when a
  change is sequenced behind another person's change, or when a resolver
  changes it.
- **Override permissions.** Only the owners of the two changes, or a team lead,
  can swap a sequence or ask for a split.
- **Views for each person and each team.** Filters for owner, team, and path.
- **Audit log.** A record of every approval, override, and token for each
  change.

### Accounts and integration

- Single sign-on for organizations, beyond Cloudflare Access.
- Import a repository from another Git host, and mirror trunk back to it.
- Landing rules, for example a required approval or a required check.
- Billing and usage limits.

## Competition requirements

The demo is our entry in Cloudflare's "Build the next GitHub" competition.

- Submissions close on October 14, 2026, at 11:59 PM PDT. Finalists are named on
  October 16 and present on October 21 at Cloudflare Connect in San Francisco.
- The project must use Cloudflare Workers and Artifacts and must let multiple
  agents work on changes at the same time.
- The submission needs a demo video of 5 to 10 minutes, the source code in a
  public repository, and instructions to run it.
- The code must use the MIT, Apache 2.0, or BSD license, with a LICENSE file.
- The work must be original. It must not include third-party copyrighted
  material without permission.
- The submission must not attack any person or any other product.
- Judging, each scored from 1 to 5:
  - Originality and quality of the prototype: 50%.
  - Concurrency, coordination, context preservation, review, and conflict
    handling: 25%.
  - Ease of use and product experience: 25%.

## Open decisions

- Eligibility: each team member must be a legal resident of the United States or
  Canada and 18 or older.
- License and ownership of the code.
- Whether the demo video can show numbers from our internal analysis.
- The team, and the two people who present on October 21 if we are a finalist.
