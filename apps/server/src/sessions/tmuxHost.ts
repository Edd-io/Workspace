import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as pty from 'node-pty';

const execFileAsync = promisify(execFile);

/**
 * Dedicated tmux configuration: tmux must be invisible. No status bar, no prefix key, no key
 * bindings (every keystroke goes to Claude), dead panes are kept so we can read the exit status.
 */
const TMUX_CONF = `
set -g status off
set -g prefix None
set -g prefix2 None
unbind-key -a -T prefix
unbind-key -a -T root
unbind-key -a -T copy-mode
unbind-key -a -T copy-mode-vi
set -g mouse off
set -g escape-time 0
set -g history-limit 20000
set -g default-terminal "tmux-256color"
set -as terminal-features ",xterm-256color:RGB:extkeys:clipboard:focus:strikethrough:usstyle"
set -g extended-keys on
set -g focus-events on
set -g remain-on-exit on
set -g window-size latest
set -g aggressive-resize on
set -g set-clipboard on
set -g allow-rename off
set -g automatic-rename off
set -g set-titles off
set -g exit-empty off
`;

export interface PaneStatus {
  session: string;
  dead: boolean;
  exitStatus: number | null;
}

export interface TmuxHostOptions {
  bin: string;
  socket: string;
  dataDir: string;
}

/** Hosts one tmux session per desk, outside the Node process so sessions survive server restarts. */
export class TmuxHost {
  private readonly bin: string;
  private readonly socket: string;
  private readonly confPath: string;

  constructor(options: TmuxHostOptions) {
    this.bin = options.bin;
    this.socket = options.socket;
    this.confPath = join(options.dataDir, 'tmux.conf');
    writeFileSync(this.confPath, TMUX_CONF);
  }

  sessionName(deskId: string): string {
    return `desk-${deskId}`;
  }

  private async tmux(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync(this.bin, ['-L', this.socket, '-f', this.confPath, ...args], {
      encoding: 'utf8',
    });
    return stdout;
  }

  async has(deskId: string): Promise<boolean> {
    try {
      await this.tmux(['has-session', '-t', `=${this.sessionName(deskId)}`]);
      return true;
    } catch {
      return false;
    }
  }

  async create(
    deskId: string,
    options: { cwd: string; command: string; cols: number; rows: number },
  ): Promise<void> {
    await this.tmux([
      'new-session',
      '-d',
      '-s',
      this.sessionName(deskId),
      '-x',
      String(options.cols),
      '-y',
      String(options.rows),
      '-c',
      options.cwd,
      options.command,
    ]);
  }

  /** Restarts the command of an existing session (dead or alive). */
  async respawn(deskId: string, options: { cwd: string; command: string }): Promise<void> {
    await this.tmux([
      'respawn-pane',
      '-k',
      '-t',
      `=${this.sessionName(deskId)}:`,
      '-c',
      options.cwd,
      options.command,
    ]);
  }

  async kill(deskId: string): Promise<void> {
    try {
      await this.tmux(['kill-session', '-t', `=${this.sessionName(deskId)}`]);
    } catch {
      // Already gone.
    }
  }

  /** Status of every desk pane, in one tmux call. */
  async listPanes(): Promise<Map<string, PaneStatus>> {
    const result = new Map<string, PaneStatus>();
    let output: string;
    try {
      output = await this.tmux([
        'list-panes',
        '-a',
        '-F',
        '#{session_name}\t#{pane_dead}\t#{pane_dead_status}',
      ]);
    } catch {
      return result; // No tmux server running.
    }
    for (const line of output.split('\n')) {
      const [session, dead, status] = line.split('\t');
      if (!session?.startsWith('desk-')) continue;
      result.set(session.slice('desk-'.length), {
        session,
        dead: dead === '1',
        exitStatus: status ? Number(status) : null,
      });
    }
    return result;
  }

  /** Opens a PTY attached to the desk session; its output mirrors the Claude TUI. */
  attach(deskId: string, cols: number, rows: number): pty.IPty {
    return pty.spawn(
      this.bin,
      ['-L', this.socket, '-f', this.confPath, 'attach-session', '-t', `=${this.sessionName(deskId)}`],
      {
        name: 'xterm-256color',
        cols,
        rows,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>,
      },
    );
  }
}
