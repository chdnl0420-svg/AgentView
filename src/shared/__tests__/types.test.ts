// Compile-time type tests for BackendKind union and optional `backend`
// field on BgSession / NewSessionInput. Verified by `npm run typecheck`
// (tsc --noEmit). Not executed at runtime.
import type { BgSession, BackendKind, NewSessionInput } from '../types';

// 1. BackendKind union accepts the three known values.
const bk1: BackendKind = 'claude';
const bk2: BackendKind = 'external-claude';
const bk3: BackendKind = 'codex';

// 2. BackendKind union rejects unknown values.
// @ts-expect-error — 'gpt5' is not part of BackendKind.
const bkBad: BackendKind = 'gpt5';

// 3. BgSession.backend is optional and accepts BackendKind values.
const sessionA: BgSession = {
  pid: 1,
  sessionId: 's1',
  cwd: '/x',
  startedAt: 0,
  updatedAt: 0,
  status: 'running',
  alive: true,
  metaPath: '',
  conversationPath: null,
  conversationSize: 0,
  backend: 'codex',
};

const sessionB: BgSession = {
  pid: 2,
  sessionId: 's2',
  cwd: '/y',
  startedAt: 0,
  updatedAt: 0,
  status: 'idle',
  alive: false,
  metaPath: '',
  conversationPath: null,
  conversationSize: 0,
};

// 4. NewSessionInput.backend is optional and accepts null (explicit absent).
const inp1: NewSessionInput = { prompt: 'p', cwd: '/x', backend: 'claude' };
const inp2: NewSessionInput = { prompt: 'p', cwd: '/x', backend: null };
const inp3: NewSessionInput = { prompt: 'p', cwd: '/x' };

// Reference each binding so isolatedModules doesn't strip the file.
export const __compileProbe = [bk1, bk2, bk3, bkBad, sessionA, sessionB, inp1, inp2, inp3].length;
