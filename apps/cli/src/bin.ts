#!/usr/bin/env node
import { run } from './main.js'

/**
 * The only module that touches the process. Everything above it is a function
 * of its arguments, which is why the CLI can be specified without spawning.
 */
const result = await run({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: process.env,
  isTty: process.stdout.isTTY === true,
  // Streamed as it arrives. A run's output belongs on screen while it happens,
  // not collected and printed once it is over.
  write: (line) => console.log(line),
})

for (const line of result.lines) console.log(line)
process.exitCode = result.exitCode
