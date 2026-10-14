// The voiceover: one clip per caption, in the narrator's cloned voice. voice.ts writes the clips and their index, and
// compose places each clip where its caption shows.
import { z } from 'zod';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

export const VOICE_DIR = 'voice';
const INDEX_FILE = 'index.json';
// A clip starts this long after its caption shows, and the next caption waits this long after the clip ends.
export const VOICE_LEAD_MS = 150;
const VOICE_TAIL_MS = 350;

const voiceClipSchema = z.object({
  // The hash of everything that shapes the clip, so that a changed caption or setting makes a new clip.
  key: z.string().min(1),
  file: z.string().min(1),
  durationMs: z.number().positive()
});

// Each caption's clip, by the caption's text.
const voiceIndexSchema = z.record(z.string(), voiceClipSchema);

export type VoiceIndex = z.infer<typeof voiceIndexSchema>;

export function voiceIndexPath(recordingDir: string): string {
  return join(recordingDir, VOICE_DIR, INDEX_FILE);
}

// The index, or an empty index before voice.ts has written a clip.
export async function readVoiceIndex(recordingDir: string): Promise<VoiceIndex> {
  let json: string;
  try {
    json = await readFile(voiceIndexPath(recordingDir), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
  return voiceIndexSchema.parse(JSON.parse(json));
}

// How long a caption must stay for its clip.
export function voiceHoldMs(clipMs: number): number {
  return VOICE_LEAD_MS + clipMs + VOICE_TAIL_MS;
}
