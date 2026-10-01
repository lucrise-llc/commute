import { z } from '@hono/zod-openapi';

export const ERROR_STATUS = {
  PROJECT_NOT_FOUND: 404,
  CHANGE_NOT_FOUND: 404,
  PROJECT_EXISTS: 409,
  TRUNK_EMPTY: 409,
  FORK_FAILED: 502
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const errorCodeSchema = z.enum([
  'PROJECT_NOT_FOUND',
  'CHANGE_NOT_FOUND',
  'PROJECT_EXISTS',
  'TRUNK_EMPTY',
  'FORK_FAILED'
]);

// Errors cross the Durable Object RPC boundary as plain errors, so the code travels in the message.
export function errorCodeOf(error: unknown): ErrorCode | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const parsed = errorCodeSchema.safeParse(error.message);
  return parsed.success ? parsed.data : null;
}

const artifactsErrorSchema = z.object({
  code: z.string()
});

export function artifactsErrorCode(error: unknown): string | null {
  const parsed = artifactsErrorSchema.safeParse(error);
  return parsed.success ? parsed.data.code : null;
}
