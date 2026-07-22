import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { loadEnv } from '../config/loadEnv.js';
import { startServer } from '../server/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

loadEnv(path.join(projectRoot, '.env'));

const config = yaml.load(fs.readFileSync(path.join(projectRoot, 'config/default.yaml'), 'utf8'));
const port = Number(process.env.PORT) || 4001;

startServer({
  projectRoot,
  dataDir: config.world.dataDir,
  nimConfig: config.nim,
  summarizeEveryNTurns: config.turn?.summarizeEveryNTurns ?? 0,
  port,
});
