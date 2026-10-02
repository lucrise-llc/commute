import { diffLines } from 'diff';

type DiffViewProps = {
  before: string | null;
  after: string | null;
};

type DiffLine = {
  kind: 'added' | 'removed' | 'same';
  oldNumber: number | null;
  newNumber: number | null;
  text: string;
};

const MARKERS = { added: '+', removed: '-', same: ' ' } as const;

const LINE_BACKGROUNDS = { added: 'bg-kumo-success-tint', removed: 'bg-kumo-danger-tint', same: '' } as const;

// A unified view of one file, with the old and new line numbers, as a Git host shows a diff.
export function DiffView({ before, after }: DiffViewProps): React.JSX.Element {
  const rows: DiffLine[] = [];
  let oldNumber = 1;
  let newNumber = 1;
  for (const part of diffLines(before ?? '', after ?? '')) {
    let kind: DiffLine['kind'] = 'same';
    if (part.added) {
      kind = 'added';
    } else if (part.removed) {
      kind = 'removed';
    }
    for (const text of part.value.replace(/\n$/, '').split('\n')) {
      rows.push({
        kind,
        oldNumber: kind === 'added' ? null : oldNumber,
        newNumber: kind === 'removed' ? null : newNumber,
        text
      });
      oldNumber += kind === 'added' ? 0 : 1;
      newNumber += kind === 'removed' ? 0 : 1;
    }
  }
  return (
    <CodeLines>
      {rows.map((row, index) => (
        <tr key={index} className={LINE_BACKGROUNDS[row.kind]}>
          <LineNumber value={row.oldNumber} />
          <LineNumber value={row.newNumber} />
          <td className="px-2.5 align-top whitespace-pre-wrap">
            {MARKERS[row.kind]} {row.text}
          </td>
        </tr>
      ))}
    </CodeLines>
  );
}

type CodeLinesProps = {
  children: React.ReactNode;
};

// The lines of a file or a diff in a monospace table, so that long lines wrap under their own number.
export function CodeLines({ children }: CodeLinesProps): React.JSX.Element {
  return (
    <div className="overflow-x-auto py-1">
      <table className="w-full border-collapse font-mono text-xs leading-5">
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

type LineNumberProps = {
  value: number | null;
};

export function LineNumber({ value }: LineNumberProps): React.JSX.Element {
  return <td className="w-px px-2.5 text-right align-top text-kumo-subtle select-none">{value}</td>;
}
