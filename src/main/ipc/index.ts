import { EVT } from '@shared/ipc-contracts';
import type { RunningSessionInfo } from '@shared/types';
import { SessionRunner } from '../sessionRunner';
import { LiveWatcher } from '../liveWatcher';
import { ensureOwnedLoaded } from '../ownedSessions';
import { broadcast } from './broadcast';
import { registerLoaders } from './loaders';
import { registerSessions } from './sessions';
import { registerPicker } from './picker';
import { registerWorkspace } from './workspace';
import { registerFilePreview } from './filePreview';
import { registerWindowChrome } from './windowChrome';
import { registerMisc } from './misc';

const runner = new SessionRunner();
const liveWatcher = new LiveWatcher();

function runningList(): RunningSessionInfo[] {
  const out: RunningSessionInfo[] = [];
  for (const [sid, pid] of runner.pidsBySession()) {
    out.push({ sessionId: sid, pid, startedAt: Date.now() });
  }
  return out;
}

/**
 * Wire every IPC handler. Called once at app ready. The split sub-modules
 * each take only what they need; cross-cutting state (the runner + the
 * live watcher) stays here and is passed into sessions.
 */
export function registerIpc(): void {
  liveWatcher.on('sessions-changed', () => broadcast(EVT.SessionsChanged));
  // session-updated fires for every meta file in ~/.claude/sessions/, including
  // CLI interactive (REPL) chats. Drop those so the renderer's grid only ever
  // sees the same set CLI `claude agents` would show.
  liveWatcher.on('session-updated', async (s) => {
    const owned = await ensureOwnedLoaded();
    const kind = (s.kind || '').toLowerCase();
    if (kind === 'bg' || kind === 'app' || owned.has(s.sessionId)) {
      broadcast(EVT.SessionUpdated, s);
    }
  });
  liveWatcher.on('conversation-appended', (a) => broadcast(EVT.ConversationAppended, a));
  liveWatcher.start();

  runner.on('event', (e) => broadcast(EVT.ClaudeRunEvent, e));
  runner.on('procs-changed', () => broadcast(EVT.RunningChanged, runningList()));

  registerLoaders();
  registerSessions({ runner, liveWatcher, runningList });
  registerPicker();
  registerWorkspace();
  registerFilePreview();
  registerWindowChrome();
  registerMisc();
}

export function shutdownIpc(): void {
  liveWatcher.stop();
  liveWatcher.unwatchAll();
  runner.disposeAll();
}
