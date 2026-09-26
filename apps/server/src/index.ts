import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AuthService } from './auth/authService.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/database.ts';
import { buildApp } from './http/app.ts';
import { BoardStore } from './office/boardStore.ts';
import { IntegrationService } from './office/integrationService.ts';
import { OfficeService } from './office/officeService.ts';
import { RoomAwareness } from './office/roomAwareness.ts';
import { PictureStore } from './office/pictureStore.ts';
import { Insights } from './office/stats.ts';
import { Summarizer } from './office/summarizer.ts';
import { UsageTracker } from './office/usageTracker.ts';
import { WakeService } from './office/wakeService.ts';
import { loadLocales, Notifier, Presence } from './office/notifier.ts';
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
const boards = new BoardStore(db);
const awareness = new RoomAwareness(store, boards);
sessions.setHookResponder((desk, payload) => awareness.respond(desk, payload));
const summarizer = new Summarizer(store, boards, config);
const integration = new IntegrationService(store, sessions);
const usage = new UsageTracker(store);
store.on('deskRemoved', (deskId) => usage.forgetDesk(deskId));
summarizer.setUsageSource(() => usage.usage());
const wake = new WakeService(store, boards, sessions);
wake.start();
const presence = new Presence();
const notifier = new Notifier(store, presence, loadLocales(config.repoRoot));
notifier.start();
usage.on('alert', (alert) => notifier.onUsageAlert(alert));
const insights = new Insights(store);
const pictures = new PictureStore(db, config.dataDir);

const app = await buildApp({
  config,
  store,
  auth,
  office,
  sessions,
  boards,
  awareness,
  summarizer,
  integration,
  usage,
  notifier,
  presence,
  insights,
  pictures,
});
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
  wake.stop();
  notifier.stop();
  sessions.shutdown();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
