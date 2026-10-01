#!/usr/bin/env node
import { parseArgs } from 'node:util';

const USAGE = `Usage: commute <command>

Commands:
  start "<intent>" --paths <paths>   Start a change and get its Commute remote
  wait                               Wait for the next event of the change`;

const { positionals } = parseArgs({ allowPositionals: true, strict: false });
const [command] = positionals;

if (command === undefined) {
  console.log(USAGE);
} else {
  console.error(`commute ${command} is not built yet.\n\n${USAGE}`);
  process.exitCode = 1;
}
