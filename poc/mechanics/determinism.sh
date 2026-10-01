#!/usr/bin/env bash
# Runs the probe twice and diffs the two outputs.
# Lines that start with "TIME" hold timings and may differ; every other line must match.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
out="${1:?usage: determinism.sh <output-dir>}"
mkdir -p "$out"

bun "$here/probe.ts" "$out/run" > "$out/run1.txt"
bun "$here/probe.ts" "$out/run" > "$out/run2.txt"

changed_lines="$(diff "$out/run1.txt" "$out/run2.txt" | grep -c '^[<>]' || true)"
changed_non_time="$(diff "$out/run1.txt" "$out/run2.txt" | grep '^[<>]' | grep -vc '^[<>] TIME' || true)"
echo "lines in each run: $(wc -l < "$out/run1.txt" | tr -d ' ') and $(wc -l < "$out/run2.txt" | tr -d ' ')"
echo "raw diff: $changed_lines changed lines, of which $changed_non_time are not TIME lines"
if diff <(grep -v '^TIME' "$out/run1.txt") <(grep -v '^TIME' "$out/run2.txt"); then
  echo "diff without TIME lines: empty"
else
  echo "diff without TIME lines: NOT empty"
  exit 1
fi
