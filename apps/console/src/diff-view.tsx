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
    <div className="code-lines mono">
      <table>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={row.kind === 'same' ? '' : `line-${row.kind}`}>
              <td className="number">{row.oldNumber}</td>
              <td className="number">{row.newNumber}</td>
              <td>
                {MARKERS[row.kind]} {row.text}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
