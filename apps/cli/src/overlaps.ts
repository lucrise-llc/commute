import type { Overlap } from '@commute/api-client';

export function describeOverlap(overlap: Overlap): string {
  const theirs = [...new Set(overlap.paths.map((pair) => pair.otherPath))].join(', ');
  const yours = [...new Set(overlap.paths.map((pair) => pair.path))].join(', ');
  return `${overlap.changeId} "${overlap.intent}" on ${theirs} (yours: ${yours})`;
}
