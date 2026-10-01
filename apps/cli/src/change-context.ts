import { git } from './git.ts';

export type ChangeContext = {
  url: string;
  projectId: string;
  changeId: string;
  cursor: number;
};

// A working copy from `commute start` records its change in git config, under the `commute` section.
export async function readChangeContext(cwd: string): Promise<ChangeContext> {
  const lines = await git({ args: ['config', '--get-regexp', '^commute\\.'], cwd }).catch(() => '');
  const values = new Map<string, string>();
  for (const line of lines.split('\n')) {
    const separator = line.indexOf(' ');
    if (separator > 0) {
      values.set(line.slice(0, separator), line.slice(separator + 1));
    }
  }
  const url = values.get('commute.url');
  const projectId = values.get('commute.project');
  const changeId = values.get('commute.change');
  const cursor = Number(values.get('commute.cursor') ?? '0');
  if (url === undefined || projectId === undefined || changeId === undefined || !Number.isInteger(cursor)) {
    throw new Error('Run this command inside a working copy that commute start created.');
  }
  return { url, projectId, changeId, cursor };
}

type WriteContextParams = {
  context: ChangeContext;
  cwd: string;
};

export async function writeChangeContext({ context, cwd }: WriteContextParams): Promise<void> {
  await git({ args: ['config', 'commute.url', context.url], cwd });
  await git({ args: ['config', 'commute.project', context.projectId], cwd });
  await git({ args: ['config', 'commute.change', context.changeId], cwd });
  await git({ args: ['config', 'commute.cursor', String(context.cursor)], cwd });
}
