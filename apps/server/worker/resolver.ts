import { z } from '@hono/zod-openapi';

import type { FileText } from './runner';
import type { ResolvedConflict } from './schemas';
import type { ProjectStore, ResolutionRecord } from './db/project-store';

import { sha256Hex } from './hash';

// The resolver only orders lines that both changes inserted at the same place, so it cannot put new code on trunk or
// choose between two edits. A hunk where both changes edit the same lines goes to the owner of the change.
const RESOLVER_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const CONFLICT_FILES_MAX = 10;
const HUNKS_MAX = 20;
const HUNK_SIDE_LINES_MAX = 100;
const CONTEXT_LINES = 5;
const ANSWER_TOKENS_MAX = 512;
const MARKER_LENGTH = 7;

const SYSTEM_PROMPT = [
  'You merge a conflict between two changes to the same lines of one file.',
  'You can only choose and order the numbered lines that the two changes wrote. You never write, edit, or join a line.',
  'Keep every line of both changes, in the order that serves both intents.',
  'Drop a line only when it repeats a line that you keep, and give the reason.',
  'When a correct result needs a line that neither change wrote, set canResolve to false and give the reason.'
].join(' ');

const aiOutputSchema = z.object({
  response: z.unknown()
});

type Answer = {
  canResolve: boolean;
  lines: string[];
  dropped: Array<{
    line: string;
    reason: string;
  }>;
  reason: string;
};

// The answer for one hunk names lines by ID: t1, t2, ... for the change that landed first, o1, o2, ... for the other.
function answerSchemaFor(ids: string[]): z.ZodType<Answer> {
  const lineId = z.enum(ids);
  return z.object({
    canResolve: z.boolean(),
    lines: z.array(lineId),
    dropped: z.array(
      z.object({
        line: lineId,
        reason: z.string()
      })
    ),
    reason: z.string()
  });
}

// Ours is the change that lands later, and theirs the change that landed first.
type Hunk = {
  base: string[];
  ours: string[];
  theirs: string[];
};

type Segment =
  | {
      kind: 'same';
      lines: string[];
    }
  | {
      kind: 'conflict';
      hunk: Hunk;
    };

type Marker = 'ours' | 'base' | 'theirs' | 'end';

type ParsedFile = {
  path: string;
  segments: Segment[];
};

type Choice = Pick<ResolutionRecord, 'lines' | 'dropped' | 'reason'>;

export type ConflictResolution =
  | {
      outcome: 'ready';
      resolved: FileText[];
      files: ResolvedConflict[];
      reused: number;
      chosen: number;
    }
  | {
      outcome: 'needs_owner';
      reason: string;
      reused: number;
      chosen: number;
    };

type ResolveConflictsParams = {
  ai: Ai;
  store: ProjectStore;
  conflicts: string[];
  texts: FileText[];
  oursIntent: string;
  theirsIntents: string[];
};

// Resolves every conflicted file of a merge, hunk by hunk. A hunk resolved before reuses its stored resolution, and
// a new hunk asks the resolver once and stores its answer, including an answer that needs the owner.
export async function resolveConflicts({
  ai,
  store,
  conflicts,
  texts,
  oursIntent,
  theirsIntents
}: ResolveConflictsParams): Promise<ConflictResolution> {
  const counts = { reused: 0, chosen: 0 };
  const needsOwner = (reason: string): ConflictResolution => ({ outcome: 'needs_owner', reason, ...counts });

  if (conflicts.length > CONFLICT_FILES_MAX) {
    return needsOwner(`More than ${CONFLICT_FILES_MAX} files conflict.`);
  }
  const textPaths = new Set(texts.map((file) => file.path));
  const otherConflict = conflicts.find((path) => !textPaths.has(path));
  if (otherConflict !== undefined) {
    return needsOwner(
      `${otherConflict} is not a conflict between two text files, for example a deleted or large file.`
    );
  }
  const files: ParsedFile[] = [];
  for (const file of texts) {
    const segments = parseSegments(file.text);
    if (segments === null || !segments.some((segment) => segment.kind === 'conflict')) {
      return needsOwner(`${file.path} has conflict markers that Commute cannot read.`);
    }
    files.push({ path: file.path, segments });
  }
  const hunks = files.flatMap((file) =>
    file.segments.flatMap((segment) => (segment.kind === 'conflict' ? [segment.hunk] : []))
  );
  if (hunks.length > HUNKS_MAX) {
    return needsOwner(`More than ${HUNKS_MAX} hunks conflict.`);
  }
  const editedPath = files.find((file) =>
    file.segments.some((segment) => segment.kind === 'conflict' && segment.hunk.base.length > 0)
  )?.path;
  if (editedPath !== undefined) {
    return needsOwner(`${editedPath}: both changes edit the same lines.`);
  }
  if (hunks.some((hunk) => Math.max(hunk.base.length, hunk.ours.length, hunk.theirs.length) > HUNK_SIDE_LINES_MAX)) {
    return needsOwner(`A conflicting hunk has more than ${HUNK_SIDE_LINES_MAX} lines on one side.`);
  }

  const resolved: FileText[] = [];
  const resolvedFiles: ResolvedConflict[] = [];
  for (const { path, segments } of files) {
    const lines: string[] = [];
    const resolvedFile: ResolvedConflict = { path, dropped: [] };
    for (const [index, segment] of segments.entries()) {
      if (segment.kind === 'same') {
        lines.push(...segment.lines);
        continue;
      }
      const key = await sha256Hex(JSON.stringify([segment.hunk.base, segment.hunk.ours, segment.hunk.theirs]));
      let resolution = store.findResolution(key);
      if (resolution === null) {
        const choice = await chooseLines({
          ai,
          path,
          hunk: segment.hunk,
          before: sameLines(segments[index - 1]).slice(-CONTEXT_LINES),
          after: sameLines(segments[index + 1]).slice(0, CONTEXT_LINES),
          oursIntent,
          theirsIntents
        });
        resolution = { key, ...choice, createdAt: new Date().toISOString() };
        store.saveResolution(resolution);
        counts.chosen += 1;
      } else {
        counts.reused += 1;
      }
      if (resolution.lines === null) {
        return needsOwner(`${path}: ${resolution.reason ?? 'The resolver gave no reason.'}`);
      }
      lines.push(...resolution.lines);
      resolvedFile.dropped.push(...resolution.dropped);
    }
    resolved.push({ path, text: lines.join('\n') });
    resolvedFiles.push(resolvedFile);
  }
  return { outcome: 'ready', resolved, files: resolvedFiles, ...counts };
}

function sameLines(segment: Segment | undefined): string[] {
  return segment?.kind === 'same' ? segment.lines : [];
}

// Splits a file with diff3 markers into the lines both sides agree on and the conflicting hunks. Returns null when
// the markers do not run ours, base, theirs, end.
function parseSegments(text: string): Segment[] | null {
  const segments: Segment[] = [];
  let same: string[] = [];
  let hunk: Hunk | null = null;
  let side: keyof Hunk = 'ours';
  for (const line of text.split('\n')) {
    const marker = markerOf(line);
    if (hunk === null) {
      if (marker === null) {
        same.push(line);
        continue;
      }
      if (marker !== 'ours') {
        return null;
      }
      segments.push({ kind: 'same', lines: same });
      same = [];
      hunk = { base: [], ours: [], theirs: [] };
      side = 'ours';
    } else if (marker === null) {
      hunk[side].push(line);
    } else if (side === 'ours' && marker === 'base') {
      side = 'base';
    } else if (side === 'base' && marker === 'theirs') {
      side = 'theirs';
    } else if (side === 'theirs' && marker === 'end') {
      segments.push({ kind: 'conflict', hunk });
      hunk = null;
    } else {
      return null;
    }
  }
  if (hunk !== null) {
    return null;
  }
  segments.push({ kind: 'same', lines: same });
  return segments;
}

function markerOf(line: string): Marker | null {
  if (line === '=======') {
    return 'theirs';
  }
  const label = line.slice(MARKER_LENGTH);
  if (label !== '' && !label.startsWith(' ')) {
    return null;
  }
  const prefix = line.slice(0, MARKER_LENGTH);
  if (prefix === '<<<<<<<') {
    return 'ours';
  }
  if (prefix === '|||||||') {
    return 'base';
  }
  if (prefix === '>>>>>>>') {
    return 'end';
  }
  return null;
}

type ChooseLinesParams = {
  ai: Ai;
  path: string;
  hunk: Hunk;
  before: string[];
  after: string[];
  oursIntent: string;
  theirsIntents: string[];
};

async function chooseLines({ ai, hunk, ...prompt }: ChooseLinesParams): Promise<Choice> {
  const ids = [...hunk.theirs.keys()].map((index) => `t${index + 1}`);
  ids.push(...[...hunk.ours.keys()].map((index) => `o${index + 1}`));
  const schema = answerSchemaFor(ids);
  const output = await ai.run(RESOLVER_MODEL, {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt({ hunk, ...prompt }) }
    ],
    response_format: { type: 'json_schema', json_schema: z.toJSONSchema(schema) },
    temperature: 0,
    max_tokens: ANSWER_TOKENS_MAX
  });
  return choiceFromAnswer({ hunk, answer: parseAnswer({ response: aiOutputSchema.parse(output).response, schema }) });
}

type UserPromptParams = Omit<ChooseLinesParams, 'ai'>;

function userPrompt({ path, hunk, before, after, oursIntent, theirsIntents }: UserPromptParams): string {
  const landedIntent = theirsIntents.length === 0 ? 'not recorded' : theirsIntents.join(' / ');
  return [
    `File: ${path}`,
    `Intent of the change that landed first: ${landedIntent}`,
    `Intent of the change that lands now: ${oursIntent}`,
    '',
    'Lines before the conflict:',
    ...before,
    'Original lines, before either change:',
    ...hunk.base,
    'Lines from the change that landed first:',
    numbered({ prefix: 't', lines: hunk.theirs }),
    'Lines from the change that lands now:',
    numbered({ prefix: 'o', lines: hunk.ours }),
    'Lines after the conflict:',
    ...after
  ].join('\n');
}

type NumberedParams = {
  prefix: string;
  lines: string[];
};

function numbered({ prefix, lines }: NumberedParams): string {
  return lines.map((line, index) => `${prefix}${index + 1}: ${line}`).join('\n');
}

type ParseAnswerParams = {
  response: unknown;
  schema: z.ZodType<Answer>;
};

// JSON mode returns the answer as an object or as a JSON string, and a model can still miss the schema.
function parseAnswer({ response, schema }: ParseAnswerParams): Answer | null {
  let value = response;
  if (typeof response === 'string') {
    try {
      value = JSON.parse(response);
    } catch {
      return null;
    }
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

type ChoiceFromAnswerParams = {
  hunk: Hunk;
  answer: Answer | null;
};

// An answer resolves the hunk only when it places every line of both sides exactly once, and every dropped line
// repeats a kept line.
function choiceFromAnswer({ hunk, answer }: ChoiceFromAnswerParams): Choice {
  if (answer === null) {
    return { lines: null, dropped: [], reason: 'The resolver did not answer in the expected form.' };
  }
  if (!answer.canResolve) {
    return { lines: null, dropped: [], reason: answer.reason };
  }
  const texts = new Map<string, string>([
    ...hunk.theirs.map((text, index) => [`t${index + 1}`, text] as const),
    ...hunk.ours.map((text, index) => [`o${index + 1}`, text] as const)
  ]);
  const placed = [...answer.lines, ...answer.dropped.map((drop) => drop.line)];
  if (placed.length !== texts.size || new Set(placed).size !== placed.length) {
    return { lines: null, dropped: [], reason: 'The resolver did not place every line of both changes exactly once.' };
  }
  const textOf = (id: string): string => {
    const text = texts.get(id);
    if (text === undefined) {
      throw new Error(`Line ${id} is not in the hunk.`);
    }
    return text;
  };
  const lines = answer.lines.map(textOf);
  const dropped = answer.dropped.map((drop) => ({ text: textOf(drop.line), reason: drop.reason }));
  if (dropped.some((drop) => !lines.includes(drop.text))) {
    return { lines: null, dropped: [], reason: 'The resolver dropped a line that no kept line repeats.' };
  }
  return { lines, dropped, reason: null };
}
