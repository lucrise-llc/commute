import { diffLines } from 'diff';

type DiffViewProps = {
  before: string | null;
  after: string | null;
};

// A unified view of one file: removed lines start with -, added lines with +.
export function DiffView({ before, after }: DiffViewProps): React.JSX.Element {
  const parts = diffLines(before ?? '', after ?? '');
  const lines = parts.flatMap((part) => {
    let marker = ' ';
    if (part.added) {
      marker = '+';
    } else if (part.removed) {
      marker = '-';
    }
    return part.value
      .replace(/\n$/, '')
      .split('\n')
      .map((line) => `${marker} ${line}`);
  });
  return <pre>{lines.join('\n')}</pre>;
}
