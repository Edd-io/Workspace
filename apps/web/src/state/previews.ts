import type { ServerMessage } from '@workspace/shared';
import { officeSocket } from '../api/socket';

export type PreviewFrameMessage = Extract<ServerMessage, { t: 'term.frame' }>;

type FrameListener = (frame: PreviewFrameMessage) => void;

/**
 * Latest preview frame per desk, kept outside React: frames arrive several times per second and
 * are drawn straight into canvas textures.
 */
const frames = new Map<string, PreviewFrameMessage>();
const listeners = new Map<string, Set<FrameListener>>();

officeSocket.onMessage((message) => {
  if (message.t !== 'term.frame') return;
  frames.set(message.deskId, message);
  for (const listener of listeners.get(message.deskId) ?? []) listener(message);
});

/** Subscribes to a desk's preview frames; opens the server subscription while someone listens. */
export function subscribePreview(deskId: string, listener: FrameListener): () => void {
  let set = listeners.get(deskId);
  if (!set) {
    set = new Set();
    listeners.set(deskId, set);
  }
  set.add(listener);
  const close = officeSocket.openTerminal(deskId, 'preview');
  const last = frames.get(deskId);
  if (last) listener(last);
  return () => {
    set.delete(listener);
    close();
  };
}
