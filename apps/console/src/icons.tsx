import type { Change, ChangeEvent } from '@commute/api-client';

// Commute's own small icon set, drawn on a 16 by 16 grid with the current text color.

type IconProps = {
  className?: string;
};

type SvgProps = IconProps & {
  children: React.ReactNode;
};

function Svg({ className, children }: SvgProps): React.JSX.Element {
  return (
    <svg
      className={className}
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
      {children}
    </svg>
  );
}

// Two paths that cross and continue: changes that commute.
export function MarkIcon(): React.JSX.Element {
  return (
    <Svg>
      <path d="M2 5h5l4 6h3M2 11h5l4-6h3" />
    </Svg>
  );
}

export function FolderIcon({ className }: IconProps): React.JSX.Element {
  return (
    <Svg className={className}>
      <path d="M1.75 3.5h4.5l1.5 1.5h6.5v7.5h-12.5z" />
    </Svg>
  );
}

export function FileIcon({ className }: IconProps): React.JSX.Element {
  return (
    <Svg className={className}>
      <path d="M3.5 1.75h6l3 3v9.5h-9zM9.5 1.75v3h3" />
    </Svg>
  );
}

export function ChangeOpenIcon({ className }: IconProps): React.JSX.Element {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
    </Svg>
  );
}

function ChangeLandingIcon({ className }: IconProps): React.JSX.Element {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </Svg>
  );
}

export function ChangeLandedIcon({ className }: IconProps): React.JSX.Element {
  return (
    <Svg className={className}>
      <path d="M4 2v12M4 6c0 3 8 2 8 6v2" />
      <circle cx="4" cy="2.5" r="0.5" fill="currentColor" />
    </Svg>
  );
}

export function CheckIcon({ className }: IconProps): React.JSX.Element {
  return (
    <Svg className={className}>
      <path d="M3 8.5l3 3 7-7" />
    </Svg>
  );
}

function CrossIcon({ className }: IconProps): React.JSX.Element {
  return (
    <Svg className={className}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Svg>
  );
}

export function ClockIcon({ className }: IconProps): React.JSX.Element {
  return (
    <Svg className={className}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3h2.5" />
    </Svg>
  );
}

export function CommitIcon({ className }: IconProps): React.JSX.Element {
  return (
    <Svg className={className}>
      <path d="M1 8h4M11 8h4" />
      <circle cx="8" cy="8" r="3" />
    </Svg>
  );
}

export function OverlapIcon({ className }: IconProps): React.JSX.Element {
  return (
    <Svg className={className}>
      <circle cx="6" cy="8" r="4" />
      <circle cx="10" cy="8" r="4" />
    </Svg>
  );
}

// Two lines that join into one: lines from both changes, kept together.
export function ResolveIcon({ className }: IconProps): React.JSX.Element {
  return (
    <Svg className={className}>
      <path d="M4 2v3c0 3 4 3 4 6v3M12 2v3c0 3-4 3-4 6" />
    </Svg>
  );
}

type StateIconProps = {
  state: Change['state'];
};

export function StateIcon({ state }: StateIconProps): React.JSX.Element {
  if (state === 'landed') {
    return <ChangeLandedIcon className="icon-landed" />;
  }
  if (state === 'landing') {
    return <ChangeLandingIcon className="icon-landing" />;
  }
  return <ChangeOpenIcon className="icon-open" />;
}

type EventIconProps = {
  event: ChangeEvent;
};

export function EventIcon({ event }: EventIconProps): React.JSX.Element {
  switch (event.type) {
    case 'overlap_found':
    case 'merge_checked': {
      return <OverlapIcon className="icon-muted" />;
    }
    case 'resolution': {
      return <ResolveIcon className={event.outcome === 'ready' ? 'icon-open' : 'icon-fail'} />;
    }
    case 'restacked': {
      return <CommitIcon className="icon-muted" />;
    }
    case 'restack_conflict':
    case 'landing_failed': {
      return <CrossIcon className="icon-fail" />;
    }
    case 'checks_done': {
      return event.failed.length === 0 ? <CheckIcon className="icon-open" /> : <CrossIcon className="icon-fail" />;
    }
    case 'landed': {
      return <ChangeLandedIcon className="icon-landed" />;
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
    return <CheckIcon className="icon-open" />;
  }
  if (outcome === 'fail') {
    return <CrossIcon className="icon-fail" />;
  }
  return <ClockIcon className="icon-landing" />;
}
