// The terminal transcript of one demo agent: each command it ran, as its terminal shows it, with the real output.
import { z } from 'zod';

export const TRANSCRIPT_COMMANDS_MAX = 120;
const COMMAND_LENGTH_MAX = 500;
const OUTPUT_LENGTH_MAX = 20_000;

// atMs is milliseconds since the harness started. dir is the working directory relative to the demo's work
// directory: "." for commute start, the agent's clone for the rest.
const transcriptCommandSchema = z.object({
  atMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  dir: z.string().min(1),
  command: z.string().min(1).max(COMMAND_LENGTH_MAX),
  output: z.string().max(OUTPUT_LENGTH_MAX)
});

export const transcriptSchema = z.object({
  agent: z.string().min(1),
  changeId: z.string().min(1),
  commands: z.array(transcriptCommandSchema).min(1).max(TRANSCRIPT_COMMANDS_MAX)
});

export type Transcript = z.infer<typeof transcriptSchema>;
export type TranscriptCommand = z.infer<typeof transcriptCommandSchema>;
