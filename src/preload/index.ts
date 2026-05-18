import { contextBridge, ipcRenderer } from 'electron';
import { EVT, IPC, type AgentViewApi } from '@shared/ipc-contracts';
import type { BgSession, ConversationAppend, JobEvent, JobInfo } from '@shared/types';

const api: AgentViewApi = {
  sessions: {
    list: () => ipcRenderer.invoke(IPC.SessionsList),
    read: (id) => ipcRenderer.invoke(IPC.SessionsRead, id),
    kill: (pid) => ipcRenderer.invoke(IPC.SessionsKill, pid),
    reveal: (path) => ipcRenderer.invoke(IPC.SessionsReveal, path),
    watch: (id) => ipcRenderer.invoke(IPC.SessionsWatch, id),
    unwatch: (id) => ipcRenderer.invoke(IPC.SessionsUnwatch, id),
    onChanged: (handler) => {
      const listener = () => handler();
      ipcRenderer.on(EVT.SessionsChanged, listener);
      return () => ipcRenderer.off(EVT.SessionsChanged, listener);
    },
    onSessionUpdated: (handler) => {
      const listener = (_e: unknown, s: BgSession) => handler(s);
      ipcRenderer.on(EVT.SessionUpdated, listener);
      return () => ipcRenderer.off(EVT.SessionUpdated, listener);
    },
    onConversationAppended: (handler) => {
      const listener = (_e: unknown, a: ConversationAppend) => handler(a);
      ipcRenderer.on(EVT.ConversationAppended, listener);
      return () => ipcRenderer.off(EVT.ConversationAppended, listener);
    }
  },
  agents: {
    list: () => ipcRenderer.invoke(IPC.AgentsList)
  },
  jobs: {
    start: (input) => ipcRenderer.invoke(IPC.JobsStart, input),
    list: () => ipcRenderer.invoke(IPC.JobsList),
    cancel: (id) => ipcRenderer.invoke(IPC.JobsCancel, id),
    read: (id) => ipcRenderer.invoke(IPC.JobsRead, id),
    onEvent: (handler) => {
      const listener = (_e: unknown, evt: JobEvent) => handler(evt);
      ipcRenderer.on(EVT.JobEvent, listener);
      return () => ipcRenderer.off(EVT.JobEvent, listener);
    },
    onUpdated: (handler) => {
      const listener = (_e: unknown, j: JobInfo) => handler(j);
      ipcRenderer.on(EVT.JobUpdated, listener);
      return () => ipcRenderer.off(EVT.JobUpdated, listener);
    }
  },
  picker: {
    directory: (defaultPath) => ipcRenderer.invoke(IPC.PickDirectory, defaultPath)
  }
};

contextBridge.exposeInMainWorld('av', api);
