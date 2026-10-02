import { Text } from '@cloudflare/kumo';

import { shortCommit, timeAgo } from './describe';

type TimeAgoProps = {
  iso: string;
};

export function TimeAgo({ iso }: TimeAgoProps): React.JSX.Element {
  return <time dateTime={iso}>{timeAgo(iso)}</time>;
}

type ShortCommitProps = {
  commit: string;
};

export function ShortCommit({ commit }: ShortCommitProps): React.JSX.Element {
  return <Text variant="mono">{shortCommit(commit)}</Text>;
}
