// Entry point for hosts that launch the package by path (e.g. Claude Desktop).
// It always starts the server: hosts may spell the script path differently
// (letter case, separators) from the module's real path.
import { runStdio } from './server.mjs';

runStdio().catch(() => { process.stderr.write('AutoPets preference connection stopped.\n'); process.exitCode = 1; });
