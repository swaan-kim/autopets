import { auditTurnSelection } from '../runtime/turn-audit.mjs';
try {
  if (process.argv.length !== 4) throw Error('usage: node turn-selection-audit.mjs <absolute-test-jsonl> <thread-uuid>');
  console.log(JSON.stringify(await auditTurnSelection(process.argv[2], process.argv[3]), null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
