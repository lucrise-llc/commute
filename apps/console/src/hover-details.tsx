import { Text, Tooltip } from '@cloudflare/kumo';

import { shortCommit, timeAgo } from './describe';

type TimeAgoProps = {
  iso: string;
};

// "3 minutes ago", with the exact time on hover.
export function TimeAgo({ iso }: TimeAgoProps): React.JSX.Element {
  return (
    <Tooltip content={new Date(iso).toLocaleString()} render={<time dateTime={iso} />}>
      {timeAgo(iso)}
    </Tooltip>
  );
}

type ShortCommitProps = {
  commit: string;
};

// The short form of a commit hash, with the full hash on hover.
export function ShortCommit({ commit }: ShortCommitProps): React.JSX.Element {
  return (
    <Tooltip content={<Text variant="mono">{commit}</Text>} render={<span />}>
      <Text variant="mono">{shortCommit(commit)}</Text>
    </Tooltip>
  );
}
