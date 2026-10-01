#!/usr/bin/env node
import { runCredential } from './credential.ts';
import { runWait, WAIT_USAGE } from './wait.ts';
import { runStart, START_USAGE } from './start.ts';

const USAGE = `Usage:
  ${START_USAGE}
  ${WAIT_USAGE}

commute start forks trunk into a repository for the change and clones it into a new directory.
commute wait prints the next event for the change, such as an overlap with another change.
Both read the server from COMMUTE_URL. commute start reads the project from COMMUTE_PROJECT.`;

// process.argv holds the Node binary and the script path before the arguments.
const ARGUMENTS_START = 2;

const [command, ...args] = process.argv.slice(ARGUMENTS_START);

try {
  if (command === 'start') {
    process.exitCode = await runStart(args);
  } else if (command === 'wait') {
    process.exitCode = await runWait(args);
  } else if (command === 'credential') {
    process.exitCode = await runCredential(args);
  } else if (command === undefined || command === '--help') {
    console.log(USAGE);
  } else {
    console.error(`Unknown command ${command}.\n\n${USAGE}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
