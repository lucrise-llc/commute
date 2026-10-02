// The words of the walkthrough outside the console: the cards, and the captions over the agent's terminal. The console
// captions and the chapter titles are in record.ts, next to the steps they describe.

export const TITLE_CARD = {
  name: 'Commute',
  tagline: 'Many coding agents, one repository.',
  platform: 'Built on Cloudflare Workers, Durable Objects, Containers, Artifacts, and Workers AI.'
};

export const WHY_CARDS = [
  'One person can run ten coding agents at the same time.',
  'On a pull request host, two open changes learn that they conflict only after one of them merges. Then someone has to stop and fix it.',
  'When main moves, every open change updates and runs its checks again, even when the files it depends on did not change.',
  'Commute coordinates the agents. It knows the files of each change at the start, lands changes that commute in any order, keeps check results that still hold, and resolves conflicts at the first push.'
];

export const ARCHITECTURE_ROWS = [
  { product: 'Workers', role: 'the API, the console, and the git remote.' },
  { product: 'Artifacts', role: 'trunk and one repository per change.' },
  { product: 'Durable Objects', role: 'one coordinator per project.' },
  { product: 'Containers', role: 'merges and checks, with git.' },
  { product: 'Workers AI', role: 'the resolver, which picks lines.' }
];

export const CLOSING_CARD = {
  name: 'Commute',
  line: 'changes that commute land in any order.'
};

// The replay shows this agent's terminal, from its first command to the first command that matches the last cue.
export const TERMINAL_AGENT = 'bob-2';

export const TERMINAL_INTRO = "An agent uses two Commute commands and plain git. This is Bob's agent.";

export type TerminalCue = {
  command: RegExp;
  // The cue applies only to a command whose output matches, when set.
  output?: RegExp;
  text: string;
};

// In order: each cue shows when the agent starts to type the first matching command after the previous cue.
export const TERMINAL_CUES: TerminalCue[] = [
  {
    command: /^commute start /,
    output: /^overlap\s+c-3 /m,
    text: "commute start declares the files the change will touch. Commute already sees that Alice's c-3 touches the same file."
  },
  {
    command: /^git push/,
    text: 'The agent pushes with plain git. Commute merges the change with every change it overlaps.'
  },
  {
    command: /^commute wait/,
    output: /^resolve\s/,
    text: 'commute wait reports what happens. Here, Commute already resolved the conflict.'
  }
];

export const AGENT_CHAPTER = "What Bob's agent saw";

export const AGENT_OUTRO_INTRO = "The rest of Bob's terminal. The agent only waited and pulled.";

// The cues of the rest of the transcript, after the command of the last cue above.
export const AGENT_OUTRO_CUES: TerminalCue[] = [
  {
    command: /^commute wait/,
    output: /^restack\s+onto trunk \S+: /,
    text: "When Bob's first batch lands, Commute asks the agent to pull the new trunk."
  },
  {
    command: /^commute wait/,
    output: /^restack .+with Commute's resolution/,
    text: "When Alice's change lands, the agent pulls Commute's resolution. It never edits the conflict itself."
  },
  {
    command: /^commute wait/,
    output: /^landed\s/,
    text: "Bob's change lands in the batch Bob approved. The agent never stopped to fix a conflict."
  }
];
