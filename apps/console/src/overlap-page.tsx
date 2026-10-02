import { useParams } from 'react-router';

export function OverlapPage(): React.JSX.Element {
  const { changeId, otherChangeId } = useParams();
  return (
    <p>
      Overlap of {changeId} and {otherChangeId}
    </p>
  );
}
