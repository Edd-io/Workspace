import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.ts';
import { matchesType, PictureError, PictureStore } from '../src/office/pictureStore.ts';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'pictures-'));
  return { dataDir, store: new PictureStore(openDatabase(':memory:'), dataDir) };
}

describe('PictureStore', () => {
  it('checks the bytes against the declared type', () => {
    expect(matchesType('image/png', PNG)).toBe(true);
    expect(matchesType('image/jpeg', PNG)).toBe(false);
    expect(matchesType('image/webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe(true);
  });

  it('stores, replaces and removes a frame picture', () => {
    const { dataDir, store } = setup();
    const changes: number[] = [];
    store.on('changed', (list) => changes.push(list.length));
    expect(store.save('master-1', 'image/png', PNG, 1)).toEqual([
      { frameId: 'master-1', url: '/api/pictures/master-1?v=1' },
    ]);
    store.save('master-1', 'image/jpeg', JPEG, 2);
    expect(store.file('master-1')?.type).toBe('image/jpeg');
    // The PNG it replaced is gone.
    expect(readdirSync(join(dataDir, 'pictures'))).toEqual(['master-1.jpg']);
    store.remove('master-1');
    expect(store.list()).toEqual([]);
    expect(existsSync(join(dataDir, 'pictures', 'master-1.jpg'))).toBe(false);
    expect(changes).toEqual([1, 1, 0]);
  });

  it('refuses what is not a picture or not a frame', () => {
    const { store } = setup();
    expect(() => store.save('master-1', 'image/png', JPEG)).toThrow(PictureError);
    expect(() => store.save('master-1', 'image/svg+xml', PNG)).toThrow(PictureError);
    expect(() => store.save('../escape', 'image/png', PNG)).toThrow(PictureError);
    expect(store.file('../escape')).toBeNull();
  });
});
