#!/usr/bin/env node
// Entry point: `node dist/cli/main.js <command>`.
import { run } from './run.js';

process.exitCode = await run(process.argv.slice(2));
