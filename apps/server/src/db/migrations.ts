/** Ordered schema migrations; index + 1 is the resulting `user_version`. Never edit a shipped entry. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE auth_sessions (
    token_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    project_path TEXT NOT NULL,
    is_git_repo INTEGER NOT NULL,
    accent_color TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE desks (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    mode TEXT NOT NULL,
    workdir TEXT NOT NULL,
    branch TEXT,
    session_id TEXT NOT NULL,
    model TEXT,
    permission_mode TEXT,
    appearance_seed INTEGER NOT NULL,
    position INTEGER NOT NULL,
    token TEXT NOT NULL,
    desired_running INTEGER NOT NULL DEFAULT 1,
    initial_prompt TEXT,
    transcript_path TEXT,
    state TEXT NOT NULL,
    state_since INTEGER NOT NULL,
    in_turn INTEGER NOT NULL DEFAULT 0,
    current_task TEXT,
    current_tool TEXT,
    last_prompt TEXT,
    last_assistant_message TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (room_id, slug)
  );

  CREATE TABLE desk_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    desk_id TEXT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    state TEXT,
    data TEXT
  );
  CREATE INDEX desk_events_desk_ts ON desk_events (desk_id, ts);
  CREATE INDEX desk_events_ts ON desk_events (ts);
  `,
  `
  ALTER TABLE desks ADD COLUMN blockers TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE desks ADD COLUMN session_title TEXT;
  `,
  `
  CREATE TABLE room_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    from_desk_id TEXT,
    to_desk_id TEXT,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX room_messages_room ON room_messages (room_id, id);

  CREATE TABLE room_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    desk_id TEXT,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX room_notes_room ON room_notes (room_id, id);

  ALTER TABLE desks ADD COLUMN last_read_message_id INTEGER NOT NULL DEFAULT 0;
  `,
  `
  ALTER TABLE desks ADD COLUMN attention TEXT;
  `,
  `
  ALTER TABLE desks ADD COLUMN base_branch TEXT;
  `,
];
