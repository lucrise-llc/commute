import type { Icon } from '@phosphor-icons/react';
import type { Change, ChangeEvent } from '@commute/api-client';

import { cn, Loader } from '@cloudflare/kumo';
import {
  ArrowsMergeIcon,
  CheckCircleIcon,
  ClockCountdownIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  IntersectIcon,
  StackIcon,
  XCircleIcon
} from '@phosphor-icons/react';

// The size of an icon that sits in a line of text.
export const ICON_CLASS = 'size-4 shrink-0';

type ChangeState = Change['state'];

const STATE_ICONS: Record<ChangeState, Icon> = {
  open: GitPullRequestIcon,
  landing: ClockCountdownIcon,
  landed: GitMergeIcon
};

const STATE_COLORS: Record<ChangeState, string> = {
  open: 'text-kumo-success',
  landing: 'text-kumo-warning',
  landed: 'text-kumo-info'
};

// Two paths that cross and continue: changes that commute.
export function MarkIcon(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 5h5l4 6h3M2 11h5l4-6h3" />
    </svg>
  );
}

type StateIconProps = {
  state: ChangeState;
  className?: string;
};

export function StateIcon({ state, className }: StateIconProps): React.JSX.Element {
  const StateGlyph = STATE_ICONS[state];
  return <StateGlyph className={cn(ICON_CLASS, STATE_COLORS[state], className)} />;
}

type EventIconProps = {
  event: ChangeEvent;
};

export function EventIcon({ event }: EventIconProps): React.JSX.Element {
  switch (event.type) {
    case 'overlap_found':
    case 'merge_checked': {
      return <IntersectIcon className={cn(ICON_CLASS, 'text-kumo-subtle')} />;
    }
    case 'resolution': {
      return (
        <ArrowsMergeIcon
          className={cn(ICON_CLASS, event.outcome === 'ready' ? 'text-kumo-success' : 'text-kumo-danger')}
        />
      );
    }
    case 'restacked': {
      return <StackIcon className={cn(ICON_CLASS, 'text-kumo-subtle')} />;
    }
    case 'restack_conflict':
    case 'landing_failed': {
      return <XCircleIcon weight="fill" className={cn(ICON_CLASS, 'text-kumo-danger')} />;
    }
    case 'checks_done': {
      return event.failed.length === 0 ? (
        <CheckCircleIcon weight="fill" className={cn(ICON_CLASS, 'text-kumo-success')} />
      ) : (
        <XCircleIcon weight="fill" className={cn(ICON_CLASS, 'text-kumo-danger')} />
      );
    }
    case 'landed': {
      return <StateIcon state="landed" />;
    }
    default: {
      const unknown: never = event;
      throw new Error(`Unknown event: ${JSON.stringify(unknown)}`);
    }
  }
}

type CheckOutcomeIconProps = {
  outcome: Change['checks'][number]['outcome'];
};

export function CheckOutcomeIcon({ outcome }: CheckOutcomeIconProps): React.JSX.Element {
  if (outcome === 'pass') {
    return <CheckCircleIcon weight="fill" className={cn(ICON_CLASS, 'text-kumo-success')} />;
  }
  if (outcome === 'fail') {
    return <XCircleIcon weight="fill" className={cn(ICON_CLASS, 'text-kumo-danger')} />;
  }
  return <Loader size="sm" aria-label="Running" className="shrink-0 text-kumo-warning" />;
}
