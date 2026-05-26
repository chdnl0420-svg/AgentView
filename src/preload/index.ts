import { contextBridge, ipcRenderer } from 'electron';
import { EVT, IPC, type AgentViewApi } from '@shared/ipc-contracts';
import type {
  BgSession,
  ClaudeRunEvent,
  ConversationAppend,
  PermissionPromptEvent,
  RunningSessionInfo
} from '@shared/types';

const api: AgentViewApi = {
  sessions: {
    list: () => ipcRenderer.invoke(IPC.SessionsList),
    read: (id) => ipcRenderer.invoke(IPC.SessionsRead, id),
    kill: (pid) => ipcRenderer.invoke(IPC.SessionsKill, pid),
    reveal: (path) => ipcRenderer.invoke(IPC.SessionsReveal, path),
    watch: (id) => ipcRenderer.invoke(IPC.SessionsWatch, id),
    unwatch: (id) => ipcRenderer.invoke(IPC.SessionsUnwatch, id),
    newSession: (input) => ipcRenderer.invoke(IPC.SessionsNew, input),
    sendMessage: (input) => ipcRenderer.invoke(IPC.SessionsResume, input),
    fork: (input) => ipcRenderer.invoke(IPC.SessionsFork, input),
    cancel: (id) => ipcRenderer.invoke(IPC.SessionsCancel, id),
    runningList: () => ipcRenderer.invoke(IPC.SessionsRunningList),
    watchOutput: (id) => ipcRenderer.invoke(IPC.SessionsWatchOutput, id),
    unwatchOutput: (id) => ipcRenderer.invoke(IPC.SessionsUnwatchOutput, id),
    answerPrompt: (id, key) => ipcRenderer.invoke(IPC.SessionsAnswerPrompt, id, key),
    renameJob: (id, name) => ipcRenderer.invoke(IPC.SessionsRenameJob, id, name),
    setPermission: (id, mode) => ipcRenderer.invoke(IPC.SessionsSetPermission, id, mode),
    setModel: (id, model) => ipcRenderer.invoke(IPC.SessionsSetModel, id, model),
    deleteMany: (ids) => ipcRenderer.invoke(IPC.SessionsDelete, ids),
    fetchUsage: () => ipcRenderer.invoke(IPC.UsageFetch),
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
    },
    onRunEvent: (handler) => {
      const listener = (_e: unknown, evt: ClaudeRunEvent) => handler(evt);
      ipcRenderer.on(EVT.ClaudeRunEvent, listener);
      return () => ipcRenderer.off(EVT.ClaudeRunEvent, listener);
    },
    onRunningChanged: (handler) => {
      const listener = (_e: unknown, info: RunningSessionInfo[]) => handler(info);
      ipcRenderer.on(EVT.RunningChanged, listener);
      return () => ipcRenderer.off(EVT.RunningChanged, listener);
    },
    onPermissionPrompt: (handler) => {
      const listener = (_e: unknown, p: PermissionPromptEvent) => handler(p);
      ipcRenderer.on(EVT.PermissionPrompt, listener);
      return () => ipcRenderer.off(EVT.PermissionPrompt, listener);
    }
  },
  agents: {
    list: () => ipcRenderer.invoke(IPC.AgentsList)
  },
  shell: {
    openPath: (path) => ipcRenderer.invoke(IPC.ShellOpenPath, path),
    copyFile: (path) => ipcRenderer.invoke(IPC.ShellCopyFile, path)
  },
  file: {
    preview: (path) => ipcRenderer.invoke(IPC.FilePreview, path)
  },
  updater: {
    check: () => ipcRenderer.invoke(IPC.UpdaterCheck),
    download: () => ipcRenderer.invoke(IPC.UpdaterDownload),
    openReleasePage: () => ipcRenderer.invoke(IPC.UpdaterOpenReleasePage),
    version: () => ipcRenderer.invoke(IPC.AppVersion),
    onProgress: (handler) => {
      const listener = (_e: unknown, pct: number) => handler(pct);
      ipcRenderer.on(EVT.UpdaterProgress, listener);
      return () => ipcRenderer.off(EVT.UpdaterProgress, listener);
    }
  },
  commands: {
    list: () => ipcRenderer.invoke(IPC.CommandsList)
  },
  picker: {
    directory: (defaultPath) => ipcRenderer.invoke(IPC.PickDirectory, defaultPath),
    files: (defaultPath) => ipcRenderer.invoke(IPC.PickFiles, defaultPath),
    savePastedImage: (buffer, ext) => ipcRenderer.invoke(IPC.SavePastedImage, buffer, ext)
  },
  git: {
    branches: (cwd) => ipcRenderer.invoke(IPC.GitBranches, cwd),
    defaultWorktreePath: (cwd, suffix) =>
      ipcRenderer.invoke(IPC.GitDefaultWorktreePath, cwd, suffix)
  },
  workspace: {
    list: () => ipcRenderer.invoke(IPC.WorkspaceList),
    read: (sessionId) => ipcRenderer.invoke(IPC.WorkspaceRead, sessionId),
    exportReport: (sessionId) => ipcRenderer.invoke(IPC.WorkspaceExportReport, sessionId),
    openRoot: () => ipcRenderer.invoke(IPC.WorkspaceOpenRoot)
  },
  claude: {
    status: (force?: boolean) => ipcRenderer.invoke(IPC.ClaudeStatus, force ?? false)
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC.WindowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC.WindowToggleMaximize),
    close: () => ipcRenderer.invoke(IPC.WindowClose),
    isMaximized: () => ipcRenderer.invoke(IPC.WindowIsMaximized),
    onMaximizedChanged: (handler) => {
      const listener = (_e: unknown, m: boolean) => handler(m);
      ipcRenderer.on(EVT.WindowMaximizedChanged, listener);
      return () => ipcRenderer.off(EVT.WindowMaximizedChanged, listener);
    }
  },
  options: {
    getAutostart: () => ipcRenderer.invoke(IPC.OptionsGetAutostart),
    setAutostart: (on) => ipcRenderer.invoke(IPC.OptionsSetAutostart, on)
  }
};

contextBridge.exposeInMainWorld('av', api);
