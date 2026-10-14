// The captions over the agents' sessions. The console captions and chapter titles are in record.ts.
import type { SessionCue } from './agent-sessions.ts';

// The replay shows these agents side by side: Alice's c-3 and Bob's c-5, which both add a page to src/routes.mjs.
export const SESSION_AGENTS = ['alice-3', 'bob-2'];

export const SESSIONS_INTRO =
  "Coding agents use Commute through its CLI and plain git. Alice's and Bob's agents each get a task.";

// In order of the harness clock: each cue shows when the output of the first matching command appears.
export const SESSIONS_CUES: SessionCue[] = [
  {
    agent: 'alice-3',
    command: /^commute start /,
    text: "commute start opens a change, c-3, and declares the files that Alice's agent will touch."
  },
  {
    agent: 'alice-3',
    command: /^git push/,
    text: 'The agent edits the file and pushes with plain git, to the repository of its change.'
  },
  {
    agent: 'bob-2',
    command: /^commute start /,
    output: /^overlap\s+c-3 /m,
    text: "Bob's agent declares the same file, so Commute reports the overlap with c-3 at once."
  },
  {
    agent: 'alice-3',
    command: /^commute wait/,
    output: /^checks\s/,
    text: 'commute wait returns when there is news. The checks of c-3 ran in containers and passed.'
  },
  {
    agent: 'bob-2',
    command: /^commute wait/,
    output: /^plan\s/,
    text: 'Commute merged the two changes and found a conflict. c-3 lands first, then c-5.'
  },
  {
    agent: 'bob-2',
    command: /^commute wait/,
    output: /^resolve\s/,
    text: 'Workers AI resolved the conflict with lines from both changes. It applies when c-3 lands.'
  }
];

export const SESSIONS_OUTRO_INTRO = 'Back in the two sessions. From here on, the agents only wait and pull.';

// The cues of the rest of the sessions, after the last cue above.
export const SESSIONS_OUTRO_CUES: SessionCue[] = [
  {
    agent: 'bob-2',
    command: /^commute wait/,
    output: /^checks\s/,
    text: 'Checks keep the results of folders that did not change. Only the routes check ran.'
  },
  {
    agent: 'alice-3',
    command: /^commute wait/,
    output: /^restack\s/,
    text: 'The first batch landed. commute wait tells each agent to pull the new trunk.'
  },
  {
    agent: 'alice-3',
    command: /^commute wait/,
    output: /^landed\s/,
    text: 'Alice approved her batch, and c-3 lands.'
  },
  {
    agent: 'bob-2',
    command: /^commute wait/,
    output: /^restack .+with Commute's resolution/,
    text: "Bob's agent pulls Commute's resolution. It never edits the conflict itself."
  },
  {
    agent: 'bob-2',
    command: /^commute wait/,
    output: /^landed\s/,
    text: 'c-5 lands in the batch Bob approved. Neither agent stopped to coordinate.'
  }
];
