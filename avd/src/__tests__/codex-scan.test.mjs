import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { scanCodexState } from '../../dist/codex-scan.js';

function freshRoot(tag) {
  const root = join(tmpdir(), `avd-codex-scan-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

test('scanCodexState returns empty results for missing roots', async () => {
  const root = freshRoot('missing');
  try {
    const result = await scanCodexState({ roots: [join(root, 'does-not-exist')] });
    assert.deepEqual(result.roots, []);
    assert.deepEqual(result.conversations, []);
    assert.deepEqual(result.diagnostics, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scanCodexState discovers JSONL conversations and reports malformed files', async () => {
  const root = freshRoot('jsonl');
  try {
    const codexRoot = join(root, '.codex');
    const sessionsDir = join(codexRoot, 'sessions', 'project-a');
    mkdirSync(sessionsDir, { recursive: true });
    const conversationPath = join(sessionsDir, 'conversation-a.jsonl');
    const malformedPath = join(sessionsDir, 'broken.jsonl');
    writeFileSync(conversationPath, [
      '{"type":"session.started","session_id":"native-a","cwd":"D:/Project/VisualAgents"}',
      '{"type":"agent_message","message":"hello"}',
    ].join('\n'), 'utf8');
    writeFileSync(malformedPath, '{not json}\n', 'utf8');
    writeFileSync(join(sessionsDir, 'notes.txt'), '{"session_id":"ignore-me"}', 'utf8');

    const result = await scanCodexState({ roots: [codexRoot] });

    assert.deepEqual(result.roots, [codexRoot]);
    assert.equal(result.conversations.length, 1);
    assert.equal(result.conversations[0].sessionId, 'native-a');
    assert.equal(result.conversations[0].conversationPath, conversationPath);
    assert.equal(result.conversations[0].cwd, 'D:/Project/VisualAgents');
    assert.equal(basename(result.diagnostics[0].path), 'broken.jsonl');
    assert.equal(result.diagnostics[0].reason, 'NO_VALID_JSON_LINES');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scanCodexState parses Codex session_meta payload and ignores non-session root JSONL', async () => {
  const root = freshRoot('session-meta');
  try {
    const codexRoot = join(root, '.codex');
    const sessionsDir = join(codexRoot, 'sessions', '2026', '05', '22');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(codexRoot, 'history.jsonl'), '{"session_id":"not-a-session","cwd":"D:/wrong"}\n', 'utf8');
    writeFileSync(join(sessionsDir, 'real-session.jsonl'), [
      '{"type":"agent_message","message":"metadata is not always first"}',
      '{"type":"session_meta","payload":{"id":"codex-native-1","cwd":"D:/real/workspace"}}',
      '{"type":"agent_message","message":"hello"}',
    ].join('\n'), 'utf8');

    const result = await scanCodexState({ roots: [codexRoot] });

    assert.equal(result.conversations.length, 1);
    assert.equal(result.conversations[0].sessionId, 'codex-native-1');
    assert.equal(result.conversations[0].cwd, 'D:/real/workspace');
    assert.equal(result.diagnostics.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scanCodexState honors maxDepth while walking Codex roots', async () => {
  const root = freshRoot('depth');
  try {
    const codexRoot = join(root, '.codex');
    const shallowDir = join(codexRoot, 'sessions');
    const deepDir = join(codexRoot, 'a', 'b', 'c', 'd');
    mkdirSync(shallowDir, { recursive: true });
    mkdirSync(deepDir, { recursive: true });
    writeFileSync(join(shallowDir, 'shallow.jsonl'), '{"session_id":"shallow"}\n', 'utf8');
    writeFileSync(join(deepDir, 'deep.jsonl'), '{"session_id":"deep"}\n', 'utf8');

    const result = await scanCodexState({ roots: [codexRoot], maxDepth: 2 });

    assert.deepEqual(result.conversations.map((item) => item.sessionId), ['shallow']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
