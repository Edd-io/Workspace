import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export interface DirectoryListing {
  path: string;
  parent: string | null;
  isGitRepo: boolean;
  directories: { name: string; path: string; isGitRepo: boolean }[];
}

/** Lists sub-folders of a server directory, for the project picker of the room creation form. */
export function listDirectories(path: string | undefined): DirectoryListing {
  const current = resolve(path ?? homedir());
  const entries = readdirSync(current, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => {
      const full = join(current, entry.name);
      return { name: entry.name, path: full, isGitRepo: existsSync(join(full, '.git')) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = dirname(current);
  return {
    path: current,
    parent: parent === current ? null : parent,
    isGitRepo: existsSync(join(current, '.git')),
    directories,
  };
}
