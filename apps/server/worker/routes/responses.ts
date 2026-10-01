import type { ZodType } from 'zod';

import { errorSchema } from '../schemas';

type JsonResponseParams<Schema extends ZodType> = {
  schema: Schema;
  description: string;
};

export function jsonResponse<Schema extends ZodType>({
  schema,
  description
}: JsonResponseParams<Schema>): {
  content: {
    'application/json': {
      schema: Schema;
    };
  };
  description: string;
} {
  return { content: { 'application/json': { schema } }, description };
}

export function errorResponse(description: string): ReturnType<typeof jsonResponse<typeof errorSchema>> {
  return jsonResponse({ schema: errorSchema, description });
}
