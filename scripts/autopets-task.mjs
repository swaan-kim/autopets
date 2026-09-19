#!/usr/bin/env node
// Repository convenience entrypoint; the distributable skill is self-contained.
import { main } from '../skills/autopets/scripts/connect.mjs';
await main();
