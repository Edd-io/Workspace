import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { rmSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type {
  CreateDeskInput,
  CreateRoomInput,
  Room,
  UpdateDeskInput,
  UpdateRoomInput,
} from '@workspace/shared';
import type { Config } from '../config.ts';
import { createWorktree, GitError, hasUncommittedChanges, isGitRepo, removeWorktree } from '../git/git.ts';
import { deskDir } from '../sessions/launchConfig.ts';
import type { SessionManager } from '../sessions/sessionManager.ts';
import type { DeskRecord, OfficeStore } from '../store/officeStore.ts';

/** Default desk names: computing pioneers. */
const DESK_NAMES = [
  'Ada',
  'Grace',
  'Alan',
  'Linus',
  'Margaret',
  'Dennis',
  'Barbara',
  'Edsger',
  'Frances',
  'Donald',
  'Radia',
  'Guido',
  'Hedy',
  'Katherine',
  'Ken',
  'Sophie',
  'Tim',
  'Annie',
  'John',
  'Karen',
  'Bjarne',
  'Shafi',
  'Yukihiro',
  'Adele',
  'Claude',
  'Evelyn',
  'Niklaus',
  'Jean',
  'Vint',
  'Lynn',
];

const ROOM_COLORS = ['#e07a5f', '#3d85c6', '#81b29a', '#f2cc8f', '#9b72cf', '#e56b6f', '#4ecdc4', '#b5838d'];

export class OfficeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function shortId(): string {
  return randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').toLowerCase().slice(0, 8);
}

export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug || 'desk';
}

export class OfficeService {
  private readonly store: OfficeStore;
  private readonly sessions: SessionManager;
  private readonly config: Config;

  constructor(store: OfficeStore, sessions: SessionManager, config: Config) {
    this.store = store;
    this.sessions = sessions;
    this.config = config;
  }

  // ---- rooms ----------------------------------------------------------------------------------

  async createRoom(input: CreateRoomInput): Promise<Room> {
    if (!isAbsolute(input.projectPath)) {
      throw new OfficeError('path_not_absolute', 'The project path must be absolute.');
    }
    const projectPath = resolve(input.projectPath);
    let isDirectory = false;
    try {
      isDirectory = statSync(projectPath).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (!isDirectory) throw new OfficeError('path_not_found', 'The project folder does not exist.');

    const position = this.store.nextRoomPosition();
    const room: Room = {
      id: shortId(),
      name: input.name,
      projectPath,
      isGitRepo: await isGitRepo(projectPath),
      accentColor: input.accentColor ?? ROOM_COLORS[position % ROOM_COLORS.length]!,
      position,
      createdAt: Date.now(),
    };
    this.store.insertRoom(room);
    return room;
  }

  updateRoom(id: string, input: UpdateRoomInput): Room {
    const room = this.store.updateRoom(id, input);
    if (!room) throw new OfficeError('room_not_found', 'Room not found.', 404);
    return room;
  }

  async deleteRoom(id: string, force: boolean): Promise<void> {
    if (!this.store.getRoom(id)) throw new OfficeError('room_not_found', 'Room not found.', 404);
    const desks = this.store.listDesksInRoom(id);
    if (desks.length > 0 && !force) {
      throw new OfficeError('room_not_empty', 'The room still has desks.', 409);
    }
    for (const desk of desks) await this.deleteDesk(desk.id, true);
    this.store.deleteRoom(id);
  }

  // ---- desks ----------------------------------------------------------------------------------

  private pickName(roomId: string): string {
    const used = new Set(this.store.listDesksInRoom(roomId).map((desk) => desk.name));
    const free = DESK_NAMES.filter((name) => !used.has(name));
    if (free.length > 0) return free[randomInt(free.length)]!;
    return `${DESK_NAMES[randomInt(DESK_NAMES.length)]} ${used.size + 1}`;
  }

  private uniqueSlug(roomId: string, name: string): string {
    const used = new Set(this.store.listDesksInRoom(roomId).map((desk) => desk.slug));
    const base = slugify(name);
    let slug = base;
    for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
    return slug;
  }

  worktreeRoot(desk: Pick<DeskRecord, 'roomId' | 'slug'>): string {
    return join(this.config.dataDir, 'worktrees', desk.roomId, desk.slug);
  }

  async createDesk(input: CreateDeskInput): Promise<DeskRecord> {
    const room = this.store.getRoom(input.roomId);
    if (!room) throw new OfficeError('room_not_found', 'Room not found.', 404);
    if (input.mode === 'worktree' && !room.isGitRepo) {
      throw new OfficeError('not_a_git_repo', 'Worktree mode needs the project to be a git repository.');
    }

    const id = shortId();
    const name = input.name ?? this.pickName(room.id);
    const slug = this.uniqueSlug(room.id, name);
    let workdir = room.projectPath;
    let branch: string | null = null;

    if (input.mode === 'worktree') {
      branch = `workspace/${slug}-${id.slice(0, 4)}`;
      try {
        workdir = await createWorktree(
          room.projectPath,
          this.worktreeRoot({ roomId: room.id, slug }),
          branch,
        );
      } catch (error) {
        if (error instanceof GitError) throw new OfficeError(error.code, error.message);
        throw new OfficeError('worktree_failed', `Cannot create the worktree: ${(error as Error).message}`);
      }
    }

    const now = Date.now();
    const desk: DeskRecord = {
      id,
      roomId: room.id,
      name,
      slug,
      mode: input.mode,
      workdir,
      branch,
      sessionId: randomUUID(),
      model: input.model ?? null,
      permissionMode: input.permissionMode ?? null,
      appearanceSeed: randomInt(2 ** 31),
      position: this.store.nextDeskPosition(room.id),
      state: 'offline',
      stateSince: now,
      currentTask: null,
      sessionTitle: null,
      currentTool: null,
      lastPrompt: null,
      lastAssistantMessage: null,
      attention: null,
      createdAt: now,
      token: randomBytes(24).toString('base64url'),
      desiredRunning: true,
      initialPrompt: input.initialPrompt ?? null,
      transcriptPath: null,
      inTurn: false,
      blockers: [],
    };
    this.store.insertDesk(desk);
    await this.sessions.ensureRunning(id);
    return this.store.getDesk(id)!;
  }

  updateDesk(id: string, input: UpdateDeskInput): DeskRecord {
    const desk = this.store.updateDesk(id, input);
    if (!desk) throw new OfficeError('desk_not_found', 'Desk not found.', 404);
    return desk;
  }

  private requireDesk(id: string): DeskRecord {
    const desk = this.store.getDesk(id);
    if (!desk) throw new OfficeError('desk_not_found', 'Desk not found.', 404);
    return desk;
  }

  async startDesk(id: string): Promise<void> {
    this.requireDesk(id);
    await this.sessions.ensureRunning(id);
  }

  async stopDesk(id: string): Promise<void> {
    this.requireDesk(id);
    await this.sessions.stop(id);
  }

  async restartDesk(id: string): Promise<void> {
    this.requireDesk(id);
    await this.sessions.restart(id);
  }

  /** Deletes a desk. Its worktree is removed but its branch is always kept. */
  async deleteDesk(id: string, force: boolean): Promise<void> {
    const desk = this.requireDesk(id);
    if (desk.mode === 'worktree' && !force && (await hasUncommittedChanges(desk.workdir))) {
      throw new OfficeError('uncommitted_changes', 'The desk has uncommitted changes in its worktree.', 409);
    }
    await this.sessions.remove(id);
    if (desk.mode === 'worktree') {
      const room = this.store.getRoom(desk.roomId);
      try {
        if (room) await removeWorktree(room.projectPath, this.worktreeRoot(desk));
      } catch (error) {
        console.warn(`[office] cannot remove worktree of desk ${id}:`, (error as Error).message);
      }
    }
    rmSync(deskDir(this.config.dataDir, id), { recursive: true, force: true });
    this.store.deleteDesk(id);
  }
}
