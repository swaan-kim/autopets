import { runStdio } from './server.mjs';

// One line on stderr so the host log shows the server process really started.
process.stderr.write('AutoPets preference connection ready.\n');
runStdio().catch(() => { process.stderr.write('AutoPets preference connection stopped.\n'); process.exitCode = 1; });
