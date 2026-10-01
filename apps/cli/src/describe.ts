import type { ChangeEvent, Overlap } from '@commute/api-client';

export function describeOverlap(overlap: Overlap): string {
  const theirs = [...new Set(overlap.paths.map((pair) => pair.otherPath))].join(', ');
  const yours = [...new Set(overlap.paths.map((pair) => pair.path))].join(', ');
  return `${overlap.changeId} "${overlap.intent}" on ${theirs} (yours: ${yours})`;
}

export function describeEvent(event: ChangeEvent): string {
  if (event.type === 'overlap_found') {
    return `overlap  ${describeOverlap(event.overlap)}`;
  }
  const other = `${event.otherChange.changeId} "${event.otherChange.intent}"`;
  if (event.outcome === 'parallel') {
    return `plan     parallel with ${other}: the two changes merge cleanly`;
  }
  const order = event.landsFirst === event.changeId ? 'before' : 'after';
  return `plan     ${order} ${other}: conflicts on ${event.conflicts.join(', ')}`;
}
