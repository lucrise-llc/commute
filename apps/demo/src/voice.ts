#!/usr/bin/env node
import { z } from 'zod';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';

import type { Timeline } from './capture.ts';
// Writes the voiceover clips: every caption of the video, in video order, spoken by the narrator's cloned voice
// through the ElevenLabs API. A clip whose caption, neighbors, and settings did not change is kept.
import type { Scene } from './animated-scenes.ts';
import type { VoiceIndex } from './voice-clips.ts';

import { TIMELINE_FILE, timelineSchema } from './capture.ts';
import { readVoiceIndex, VOICE_DIR, voiceIndexPath } from './voice-clips.ts';
import { CHAPTER_SCENES, CLOSING_SCENES, OPENING_SCENES } from './animated-scenes.ts';
import { AGENTS_CHAPTER, SESSIONS_CUES, SESSIONS_INTRO, SESSIONS_OUTRO_CUES, SESSIONS_OUTRO_INTRO } from './story.ts';

const runFile = promisify(execFile);
const RECORDING_DIR = fileURLToPath(new URL('../recording', import.meta.url));
// The narrator's cloned voice, and the model that ElevenLabs recommends for narration.
const VOICE_ID = 'KnKsB2oCDQmohCSsQdJp';
const MODEL_ID = 'eleven_v4';
const OUTPUT_FORMAT = 'mp3_44100_128';
const TTS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=${OUTPUT_FORMAT}`;
const REQUEST_ATTEMPTS = 3;
const RETRY_BASE_MS = 2_000;
const REQUEST_TIMEOUT_MS = 120_000;
const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR_MIN = 500;
const CLIP_BYTES_MAX = 5_000_000;
const SCRIPT_LINES_MAX = 200;
const KEY_LENGTH = 16;
const JSON_INDENT = 2;
const MS_PER_SECOND = 1_000;
const SECONDS_DIGITS = 1;
// How the narrator says what a caption writes: change IDs, a file path, and an abbreviation.
const SPOKEN_FORMS: [RegExp, string][] = [
  [/\bc-(\d+)/g, 'C $1'],
  [/(?:src\/)?routes\.mjs/g, 'the routes file'],
  [/'cart'/g, 'cart'],
  [/\bIDs\b/g, 'I.D.s']
];

const envSchema = z.object({ ELEVENLABS_API_KEY: z.string().min(1) });
const durationSchema = z.coerce.number().positive();

const { ELEVENLABS_API_KEY: apiKey } = envSchema.parse(process.env);
const timeline = timelineSchema.parse(JSON.parse(await readFile(join(RECORDING_DIR, TIMELINE_FILE), 'utf8')));
const lines = scriptLines(timeline);
if (lines.length > SCRIPT_LINES_MAX) {
  throw new Error(`VOICE_SCRIPT_TOO_LONG: ${lines.length} lines, more than ${SCRIPT_LINES_MAX}.`);
}
await mkdir(join(RECORDING_DIR, VOICE_DIR), { recursive: true });
const previousIndex = await readVoiceIndex(RECORDING_DIR);
const index: VoiceIndex = {};
for (const [position, text] of lines.entries()) {
  const request = {
    model_id: MODEL_ID,
    text: spoken(text),
    previous_text: spoken(lines[position - 1] ?? ''),
    next_text: spoken(lines[position + 1] ?? '')
  };
  const key = createHash('sha256').update(JSON.stringify({ VOICE_ID, OUTPUT_FORMAT, request })).digest('hex');
  const file = `${key.slice(0, KEY_LENGTH)}.mp3`;
  const path = join(RECORDING_DIR, VOICE_DIR, file);
  const kept = previousIndex[text];
  let status = 'kept';
  if (kept?.key !== key || !(await exists(path))) {
    await writeFile(path, await speak(request));
    status = 'spoke';
  }
  const durationMs = await clipMs(path);
  index[text] = { key, file, durationMs };
  await writeIndex(index);
  const seconds = (durationMs / MS_PER_SECOND).toFixed(SECONDS_DIGITS);
  console.log(`voice ${position + 1}/${lines.length} ${status} ${seconds} s: ${text}`);
}

// Every caption in the order the video shows it, as compose builds the video.
function scriptLines(take: Timeline): string[] {
  const script: string[] = [];
  const addScenes = (scenes: Scene[]): void => {
    for (const scene of scenes) {
      for (const cue of scene.cues) {
        script.push(cue.text);
      }
    }
  };
  addScenes(OPENING_SCENES);
  script.push(SESSIONS_INTRO, ...SESSIONS_CUES.map((cue) => cue.text));
  for (const mark of take.marks) {
    if (mark.kind === 'chapter') {
      addScenes([chapterScene(mark.title)]);
    } else if (mark.kind === 'say') {
      script.push(mark.text);
    }
  }
  addScenes([chapterScene(AGENTS_CHAPTER)]);
  script.push(SESSIONS_OUTRO_INTRO, ...SESSIONS_OUTRO_CUES.map((cue) => cue.text));
  addScenes(CLOSING_SCENES);
  return script;
}

function chapterScene(title: string): Scene {
  const scene = CHAPTER_SCENES[title];
  if (scene === undefined) {
    throw new Error(`UNKNOWN_CHAPTER: ${title}`);
  }
  return scene;
}

function spoken(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SPOKEN_FORMS) {
    result = result.replaceAll(pattern, replacement);
  }
  return result;
}

type SpeechRequest = {
  model_id: string;
  text: string;
  previous_text: string;
  next_text: string;
};

// Retries a rate limit or a server error with a growing pause. Any other failure stops the run.
async function speak(request: SpeechRequest): Promise<Buffer> {
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    const response = await fetch(TTS_URL, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (response.ok) {
      const audio = Buffer.from(await response.arrayBuffer());
      if (audio.length === 0 || audio.length > CLIP_BYTES_MAX) {
        throw new Error(`VOICE_CLIP_SIZE: ${audio.length} bytes for "${request.text}".`);
      }
      return audio;
    }
    const isRetryable = response.status === TOO_MANY_REQUESTS || response.status >= SERVER_ERROR_MIN;
    if (!isRetryable || attempt === REQUEST_ATTEMPTS) {
      throw new Error(`VOICE_REQUEST_FAILED: ${response.status} for "${request.text}": ${await response.text()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * attempt));
  }
  throw new Error('VOICE_REQUEST_UNREACHABLE');
}

async function clipMs(path: string): Promise<number> {
  const { stdout } = await runFile('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    path
  ]);
  return durationSchema.parse(stdout.trim()) * MS_PER_SECOND;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// Written after every clip, through a rename, so that an interrupted run keeps the clips it already has.
async function writeIndex(voiceIndex: VoiceIndex): Promise<void> {
  const path = voiceIndexPath(RECORDING_DIR);
  await writeFile(`${path}.tmp`, `${JSON.stringify(voiceIndex, null, JSON_INDENT)}\n`);
  await rename(`${path}.tmp`, path);
}
