import { z } from '@hono/zod-openapi';

import { isCanonicalPath } from './footprint';

// The project file at the root of trunk declares the checks.
export const PROJECT_FILE_PATH = 'commute.json';
// A check that reads the whole repository declares this path, and runs again after every landing.
export const REPOSITORY_ROOT = '.';

const CHECKS_MAX = 20;
const READS_MAX = 20;
const COMMAND_LENGTH_MAX = 500;
const CHECK_NAME_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

const checkSchema = z.object({
  name: z.string().regex(CHECK_NAME_PATTERN),
  command: z.string().min(1).max(COMMAND_LENGTH_MAX),
  reads: z
    .array(
      z.string().refine((path) => path === REPOSITORY_ROOT || isCanonicalPath(path), 'A read path is canonical or "."')
    )
    .min(1)
    .max(READS_MAX),
  version: z.number().int().min(1)
});

const projectFileSchema = z.object({
  checks: z
    .array(checkSchema)
    .max(CHECKS_MAX)
    .refine((checks) => new Set(checks.map((check) => check.name)).size === checks.length, 'Check names are unique.')
});

export type CheckDeclaration = z.infer<typeof checkSchema>;

export type ProjectFile =
  | {
      isValid: true;
      checks: CheckDeclaration[];
    }
  | {
      isValid: false;
      error: string;
    };

type ReadProjectFileParams = {
  repo: ArtifactsRepo;
  commit: string;
};

// A commit without a project file declares no checks. A project file that does not parse is reported, so the change
// waits until it is fixed.
export async function readProjectFile({ repo, commit }: ReadProjectFileParams): Promise<ProjectFile> {
  const blob = await repo.readFile({ ref: commit, path: PROJECT_FILE_PATH });
  if (blob === null) {
    return { isValid: true, checks: [] };
  }
  let content: unknown;
  try {
    content = JSON.parse(await blob.text());
  } catch (error) {
    return { isValid: false, error: `${PROJECT_FILE_PATH} is not JSON: ${String(error)}` };
  }
  const parsed = projectFileSchema.safeParse(content);
  if (!parsed.success) {
    return { isValid: false, error: `${PROJECT_FILE_PATH} is not valid: ${parsed.error.message}` };
  }
  return { isValid: true, checks: parsed.data.checks };
}
