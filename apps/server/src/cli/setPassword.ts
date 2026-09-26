import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { AuthService } from '../auth/authService.ts';
import { loadConfig } from '../config.ts';
import { openDatabase } from '../db/database.ts';
import { OfficeStore } from '../store/officeStore.ts';

/** Reads a line from the terminal without echoing it. */
function askHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

const config = loadConfig();
const db = openDatabase(join(config.dataDir, 'workspace.db'));
const auth = new AuthService(db, new OfficeStore(db));

const password = process.env.WORKSPACE_NEW_PASSWORD ?? (await askHidden('New password: '));
if (!process.env.WORKSPACE_NEW_PASSWORD) {
  const confirmation = await askHidden('Confirm password: ');
  if (confirmation !== password) {
    console.error('Passwords do not match.');
    process.exit(1);
  }
}
if (password.length < 8) {
  console.error('The password must be at least 8 characters long.');
  process.exit(1);
}
await auth.setPassword(password);
console.log(`Password saved in ${config.dataDir}. All existing sessions were logged out.`);
db.close();
