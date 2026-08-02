import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lance l'application en mode capture (`BEYT_CAPTURE`) : elle ouvre chaque
 * écran, écrit `build/screenshots/*.png` puis se ferme.
 */
const require = createRequire(import.meta.url);
const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = require('electron');

const child = spawn(electron, ['.'], {
  cwd: projectRoot,
  env: { ...process.env, BEYT_CAPTURE: '1' },
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
