// Electron-side adapter for the avd daemon.
//
// chunk-5c only re-exports the workspace client + provides a small
// helper to derive the default socket path. The actual sessionRunner
// integration (feature-flagged spawn path) lives in chunk-5d.
//
// `import { AvdClient } from 'avd'` resolves via the avd workspace's
// package exports entry; the daemon binary stays at `avd/daemon`.

import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { AvdClient } from 'avd';

export { AvdClient };
export type {
  StartSessionAck,
  StartSessionInput,
  SubscribeAck,
  SubscribeOptions,
  SendMessageInput,
  SendMessageAck,
} from 'avd';

/** Resolve the daemon socket path the same way `avd/dist/daemon.js` does
 *  when AVD_SOCKET_PATH is unset. Keeping the two derivations in sync
 *  here means the main process and the daemon agree on which pipe / sock
 *  to use without a config file. */
export function defaultAvdSocketPath(): string {
  if (process.env.AVD_SOCKET_PATH) return process.env.AVD_SOCKET_PATH;
  if (platform() === 'win32') {
    return `\\\\.\\pipe\\avd-${process.env.USERNAME ?? 'user'}`;
  }
  return join(homedir(), '.agentview', 'daemon', 'avd.sock');
}

/** Connect to the daemon and return a ready-to-use client. Caller owns
 *  the returned instance and must call `close()` when done. */
export async function createAvdClient(socketPath?: string): Promise<AvdClient> {
  const client = new AvdClient();
  await client.connect(socketPath ?? defaultAvdSocketPath());
  return client;
}
