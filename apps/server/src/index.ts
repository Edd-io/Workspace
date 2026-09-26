import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AuthService } from './auth/authService.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/database.ts';
import { buildApp } from './http/app.ts';
import { OfficeService } from './office/officeService.ts';
import { SessionManager } from './sessions/sessionManager.ts';
import { TmuxHost } from './sessions/tmuxHost.ts';
import { OfficeStore } from './store/officeStore.ts';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });

const db = openDatabase(join(config.dataDir, 'workspace.db'));
const store = new OfficeStore(db);
const auth = new AuthService(db, store);
const host = new TmuxHost({ bin: config.tmuxBin, socket: config.tmuxSocket, dataDir: config.dataDir });
const sessions = new SessionManager(store, host, config);
const office = new OfficeService(store, sessions, config);

const app = await buildApp({ config, store, auth, office, sessions });
await sessions.init();
auth.purgeExpired();
await app.listen({ host: config.host, port: config.port });

if (!auth.isPasswordSet()) {
  app.log.warn('No password set yet: run `pnpm --filter @workspace/server set-password` before logging in.');
}

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  sessions.shutdown();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
