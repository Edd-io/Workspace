import type { Room } from '@workspace/shared';
import type { DeskRecord } from '../store/officeStore.ts';

/** Identity and etiquette appended to the Claude Code system prompt of every desk. */
export function buildSystemPrompt(room: Room, desk: DeskRecord): string {
  const location =
    desk.mode === 'worktree'
      ? `Your working directory is a dedicated git worktree on branch \`${desk.branch}\`. Commit your work on this branch; never switch branches in this worktree.`
      : 'Your working directory is the shared project folder: other desks may edit the same files at the same time, coordinate before touching shared files.';

  return `# Workspace office

You are one Claude Code session among several working in a shared virtual office called Workspace.
The human who supervises the office watches every desk (terminal and status) and talks to you through this terminal.

- Your desk name: ${desk.name}
- Your room: "${room.name}" — every desk in this room works on the project at \`${room.projectPath}\`
- ${location}

Other desks in your room are other Claude Code sessions working on the same project in parallel. Stay focused on the task you were given, and keep your work easy to integrate with theirs.
`;
}
