import { useEffect, useRef, useState } from 'react';
import type { AgentInfo, NewJobInput } from '@shared/types';
import { shortCwd } from '../lib/format';

interface InputBarProps {
  agents: AgentInfo[];
  defaultCwd: string;
  onStarted: (jobId: string) => void;
}

const MODELS = [
  { value: '', label: '기본 모델' },
  { value: 'opus', label: 'opus' },
  { value: 'sonnet', label: 'sonnet' },
  { value: 'haiku', label: 'haiku' }
];

export function InputBar({ agents, defaultCwd, onStarted }: InputBarProps) {
  const [prompt, setPrompt] = useState('');
  const [cwd, setCwd] = useState(defaultCwd);
  const [agent, setAgent] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [name, setName] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setCwd(defaultCwd); }, [defaultCwd]);

  const send = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const input: NewJobInput = {
        prompt: trimmed,
        cwd: cwd.trim() || defaultCwd,
        agent: agent || null,
        model: model || null,
        name: name.trim() || null
      };
      const job = await window.av.jobs.start(input);
      setPrompt('');
      setName('');
      onStarted(job.jobId);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } finally {
      setSending(false);
    }
  };

  const pickDir = async () => {
    const picked = await window.av.picker.directory(cwd || defaultCwd);
    if (picked) setCwd(picked);
  };

  return (
    <div className="input-bar">
      <div className="input-controls">
        <div className="control">
          <label htmlFor="agent-select">에이전트</label>
          <select id="agent-select" value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">기본 (claude)</option>
            {agents.map((a) => (
              <option key={`${a.scope}:${a.name}`} value={a.name}>
                {a.scope === 'project' ? '◆ ' : ''}{a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="control">
          <label htmlFor="model-select">모델</label>
          <select id="model-select" value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div className="control">
          <label>작업 폴더 (cwd)</label>
          <button type="button" className="cwd-pick" onClick={pickDir} title={cwd}>
            <span>📂</span>
            <span className="path">{shortCwd(cwd || defaultCwd, 56)}</span>
          </button>
        </div>
        <div className="control">
          <label htmlFor="name-input">이름 (선택)</label>
          <input
            id="name-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="작업 이름"
            style={{
              background: 'var(--bg-elev-2)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '5px 8px',
              minWidth: 160,
              height: 28,
              fontSize: 12
            }}
          />
        </div>
      </div>
      <div className="input-row">
        <textarea
          ref={textareaRef}
          className="input-box"
          placeholder="작업을 입력하세요. Ctrl+Enter 로 백그라운드 실행."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              send();
            }
          }}
          disabled={sending}
          rows={2}
        />
        <div className="input-send">
          <button className="btn primary" onClick={send} disabled={sending || !prompt.trim()}>
            {sending ? '실행 중…' : '▶ 백그라운드 실행'}
          </button>
          <span className="hint">Ctrl+Enter</span>
        </div>
      </div>
    </div>
  );
}
