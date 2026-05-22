// Subscription manager — tracks (sessionId → set of subscribed sockets)
// and (sessionId → watcher). When the last subscriber for a sessionId
// leaves we tear down the watcher; when a socket closes we drop it
// from every session so a misbehaving client can't leak watchers.

import type { Socket } from 'node:net';
import {
  watchConversation,
  unwatchConversation,
  type WatchHandle,
  type WatchOptions,
} from './conversation.js';

export interface SubscriptionPush {
  sessionId: string;
  data: string;
  nextOffset: number;
}

export type PushFn = (socket: Socket, push: SubscriptionPush) => void;

interface Entry {
  /**
   * `null` until the watcher resolves. Concurrent subscribe() calls for
   * the same sessionId await the same promise and share the resulting
   * watcher — no duplicate watchers, no orphaned subscriber sets.
   */
  watcher: WatchHandle | null;
  ready: Promise<WatchHandle>;
  subscribers: Set<Socket>;
}

export class Subscriptions {
  private readonly entries = new Map<string, Entry>();
  /** Reverse index — sessions each socket is subscribed to. */
  private readonly bySocket = new WeakMap<Socket, Set<string>>();

  constructor(private readonly pushFn: PushFn) {}

  async subscribe(
    sessionId: string,
    conversationPath: string,
    socket: Socket,
    opts: WatchOptions = {}
  ): Promise<{ initialOffset: number }> {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      // Insert placeholder first — any concurrent subscribe() for the same
      // sessionId joins us on `ready` instead of racing to create a
      // second watcher.
      const subscribers = new Set<Socket>();
      const ready = watchConversation(
        conversationPath,
        (chunk, nextOffset) => {
          const cur = this.entries.get(sessionId);
          if (!cur) return;
          for (const sock of cur.subscribers) {
            this.pushFn(sock, { sessionId, data: chunk, nextOffset });
          }
        },
        opts
      ).then((w) => {
        const placeholder = this.entries.get(sessionId);
        if (placeholder) placeholder.watcher = w;
        return w;
      });
      entry = { watcher: null, ready, subscribers };
      this.entries.set(sessionId, entry);
    }
    entry.subscribers.add(socket);
    let owned = this.bySocket.get(socket);
    if (!owned) {
      owned = new Set();
      this.bySocket.set(socket, owned);
    }
    owned.add(sessionId);
    const watcher = await entry.ready;
    return { initialOffset: watcher.offset };
  }

  unsubscribe(sessionId: string, socket: Socket): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry) return false;
    const removed = entry.subscribers.delete(socket);
    const owned = this.bySocket.get(socket);
    if (owned) {
      owned.delete(sessionId);
      if (owned.size === 0) this.bySocket.delete(socket);
    }
    if (entry.subscribers.size === 0) {
      // Tear down the watcher once it has resolved. If we are still
      // mid-startup, wait for `ready` so we don't leak the underlying poller.
      const tearDown = (w: WatchHandle): void => {
        unwatchConversation(w);
      };
      if (entry.watcher) {
        tearDown(entry.watcher);
      } else {
        // Hold the map entry only long enough for ready to resolve, then drop.
        entry.ready.then(tearDown).catch(() => { /* swallow */ });
      }
      this.entries.delete(sessionId);
    }
    return removed;
  }

  /** Drop a socket from every session it was subscribed to. */
  removeAll(socket: Socket): void {
    const owned = this.bySocket.get(socket);
    if (!owned) return;
    for (const sessionId of [...owned]) this.unsubscribe(sessionId, socket);
  }

  /** For tests — current live session count. */
  size(): number { return this.entries.size; }
}
