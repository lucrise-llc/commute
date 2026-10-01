import type { ChangeEvent, Overlap } from '@commute/api-client';

const SHORT_COMMIT_LENGTH = 12;

export function describeOverlap(overlap: Overlap): string {
  const theirs = [...new Set(overlap.paths.map((pair) => pair.otherPath))].join(', ');
  const yours = [...new Set(overlap.paths.map((pair) => pair.path))].join(', ');
  return `${overlap.changeId} "${overlap.intent}" on ${theirs} (yours: ${yours})`;
}

export function describeEvent(event: ChangeEvent): string {
  switch (event.type) {
    case 'overlap_found': {
      return `overlap  ${describeOverlap(event.overlap)}`;
    }
    case 'merge_checked': {
      const other = `${event.otherChange.changeId} "${event.otherChange.intent}"`;
      if (event.outcome === 'parallel') {
        return `plan     parallel with ${other}: the two changes merge cleanly`;
      }
      const order = event.landsFirst === event.changeId ? 'before' : 'after';
      return `plan     ${order} ${other}: conflicts on ${event.conflicts.join(', ')}`;
    }
    case 'landed': {
      return `landed   on trunk as ${short(event.landedCommit)} in batch ${event.batchId}, approved by ${event.approver}`;
    }
    case 'restacked': {
      return `restack  onto trunk ${short(event.trunkCommit)}: run git pull before your next push`;
    }
    case 'restack_conflict': {
      return `conflict restacking onto trunk ${short(event.trunkCommit)} on ${event.conflicts.join(', ')}`;
    }
  }
  return `landing  batch ${event.batchId} did not land; the change is open again`;
}

function short(commit: string): string {
  return commit.slice(0, SHORT_COMMIT_LENGTH);
}
