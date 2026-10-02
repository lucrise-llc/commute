import type { Change, ChangeEvent, WaitReason } from '@commute/api-client';

const SHORT_COMMIT_LENGTH = 7;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_DAY = 86_400;
const MILLISECONDS_PER_SECOND = 1_000;
const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

type CheckCounts = {
  kept: number;
  ran: number;
  pending: number;
};

// Counts the checks of a head as the Changes list does: a pending check has neither kept nor ran a result yet.
export function countChecks(checks: Change['checks']): CheckCounts {
  return {
    kept: checks.filter((check) => check.kept).length,
    ran: checks.filter((check) => !check.kept && check.outcome !== 'pending').length,
    pending: checks.filter((check) => check.outcome === 'pending').length
  };
}

export function describeCheck(check: Change['checks'][number]): string {
  if (check.outcome === 'pending') {
    return 'no result for this content yet';
  }
  return check.kept ? 'kept: a result for this content already existed' : 'ran for this content';
}

export function ownerName(owner: string | null): string {
  return owner ?? 'unknown';
}

export function shortCommit(commit: string): string {
  return commit.slice(0, SHORT_COMMIT_LENGTH);
}

export function describeEvent(event: ChangeEvent): string {
  switch (event.type) {
    case 'overlap_found': {
      return `overlaps ${event.overlap.changeId} "${event.overlap.intent}"`;
    }
    case 'merge_checked': {
      if (event.outcome === 'parallel') {
        return `merges cleanly with ${event.otherChange.changeId}: both run in parallel`;
      }
      const order = event.landsFirst === event.changeId ? 'lands before' : 'lands after';
      return `conflicts with ${event.otherChange.changeId} on ${event.conflicts.join(', ')}: ${order} it`;
    }
    case 'resolution': {
      if (event.outcome === 'needs_owner') {
        return `the conflict with ${event.otherChange.changeId} needs its owner: ${event.reason ?? ''}`;
      }
      return `Commute resolved the conflict with ${event.otherChange.changeId} on ${event.conflicts.join(', ')}; it applies when ${event.otherChange.changeId} lands`;
    }
    case 'restacked': {
      const resolved =
        event.resolvedPaths.length === 0 ? '' : `, with the resolution of ${event.resolvedPaths.join(', ')}`;
      return `restacked onto trunk ${shortCommit(event.trunkCommit)}${resolved}`;
    }
    case 'restack_conflict': {
      return `conflicts with trunk ${shortCommit(event.trunkCommit)} on ${event.conflicts.join(', ')}: ${event.reason}`;
    }
    case 'checks_done': {
      const failed = event.failed.length === 0 ? 'none failed' : `failed: ${event.failed.join(', ')}`;
      return `checks done: ${event.kept} kept, ${event.ran} ran, ${failed}`;
    }
    case 'landed': {
      return `landed on trunk as ${shortCommit(event.landedCommit)} in ${event.batchId}, approved by ${event.approver}`;
    }
    case 'landing_failed': {
      return `batch ${event.batchId} did not land; the change is open again`;
    }
    default: {
      const unknown: never = event;
      throw new Error(`Unknown event: ${JSON.stringify(unknown)}`);
    }
  }
}

export function describeWait(reason: WaitReason): string {
  const others = reason.changeIds.join(', ');
  switch (reason.code) {
    case 'NO_COMMITS': {
      return 'no commits yet';
    }
    case 'RESTACKING': {
      return 'moving onto the new trunk';
    }
    case 'RESTACK_CONFLICT': {
      return 'a conflict with trunk needs its owner';
    }
    case 'LANDS_AFTER': {
      return `lands after ${others}`;
    }
    case 'CHECKING': {
      return `merge check with ${others} is running`;
    }
    case 'CHECKS_PENDING': {
      return 'checks are running';
    }
    case 'CHECKS_INVALID': {
      return 'commute.json is not valid';
    }
    case 'CHECKS_FAILED': {
      return 'a check failed';
    }
    case 'LANDING': {
      return 'landing now';
    }
    default: {
      const unknown: never = reason.code;
      throw new Error(`Unknown wait reason: ${String(unknown)}`);
    }
  }
}

// "3 minutes ago", as a Git host shows the age of a commit or an event.
export function timeAgo(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / MILLISECONDS_PER_SECOND);
  const elapsed = Math.abs(seconds);
  if (elapsed < SECONDS_PER_MINUTE) {
    return relativeTime.format(seconds, 'second');
  }
  if (elapsed < SECONDS_PER_HOUR) {
    return relativeTime.format(Math.round(seconds / SECONDS_PER_MINUTE), 'minute');
  }
  if (elapsed < SECONDS_PER_DAY) {
    return relativeTime.format(Math.round(seconds / SECONDS_PER_HOUR), 'hour');
  }
  return relativeTime.format(Math.round(seconds / SECONDS_PER_DAY), 'day');
}
