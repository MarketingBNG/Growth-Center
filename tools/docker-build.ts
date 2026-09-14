// Builds the app image with NODE_VERSION always taken from package.json's
// "engines.node" — the single place that version is meant to live. Docker's
// own ARG can't read package.json itself (FROM resolves before any file is
// copied into the build context), so this script is the sync point instead
// of a comment asking someone to remember to update both places.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const engineNode = pkg.engines?.node as string | undefined;
if (!engineNode) throw new Error('package.json has no "engines.node" to build with.');

// "22.x" -> "22"; a plain "22.4.0" already needs no stripping.
const nodeVersion = engineNode.replace(/\.x$/, '');

const extraArgs = process.argv.slice(2);
const args = ['build', '--build-arg', `NODE_VERSION=${nodeVersion}`, ...extraArgs, '.'];

console.log(`docker ${args.join(' ')}`);
const result = spawnSync('docker', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
