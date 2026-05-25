import { useMemo, useState } from 'react';
import type { BgSession } from '@shared/types';
import { formatRelative, shortCwd } from '../lib/format';

interface SessionListProps {
  sessions: BgSession[];
  selectedId: string | null;
  onSelect: (s: BgSession) => void;
  onNewClick: () => void;
  renames: Record<string, string>;
  now: number;
}

type Filter = 'all' | 'active' | 'completed';

function dotClass(s: BgSession): string {
  if (!s.alive) return s.status === 'completed' ? 'completed' : 'finished';
  return s.status === 'running' ? 'running' : 'waiting';
}

function isActive(s: BgSession): boolean {
  return s.alive;
}

function isCompleted(s: BgSession): boolean {
  return !s.alive && s.status === 'completed';
}

function matchesQuery(s: BgSession, name: string, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  return (
    name.toLowerCase().includes(lower) ||
    (s.cwd ?? '').toLowerCase().includes(lower) ||
    (s.agent ?? '').toLowerCase().includes(lower) ||
    (s.lastUserText ?? '').toLowerCase().includes(lower)
  );
}

export function SessionList({
  sessions,
  selectedId,
  onSelect,
  onNewClick,
  renames,
  now
}: SessionListProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(
    () => ({
      all: sessions.length,
      active: sessions.filter(isActive).length,
      completed: sessions.filter(isCompleted).length,
    }),
    [sessions]
  );

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      const name = renames[s.sessionId] || s.name || s.agent || '이름 없음';
      if (!matchesQuery(s, name, query)) return false;
      if (filter === 'active') return isActive(s);
      if (filter === 'completed') return isCompleted(s);
      return true;
    });
  }, [sessions, query, filter, renames]);

  const emptyText =
    query || filter !== 'all'
      ? '일치하는 세션 없음'
      : '세션 없음 — 위 “+ 새 작업”으로 시작하세요';

  return (
    <div className="session-list">
      <div className="session-list-head">
        <button type="button" className="btn primary session-list-new" onClick={onNewClick}>
          ＋ 새 작업
        </button>
      </div>
      <div className="session-list-search-row">
        <span className="session-list-search-icon" aria-hidden="true">⌕</span>
        <input
          type="text"
          className="session-list-search"
          placeholder="이름·경로·에이전트 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="세션 검색"
        />
        {query && (
          <button
            type="button"
            className="session-list-search-clear"
            onClick={() => setQuery('')}
            aria-label="검색어 지우기"
            title="검색어 지우기"
          >
            ×
          </button>
        )}
      </div>
      <div className="session-list-filters" role="tablist">
        <button
          type="button"
          className={`session-list-filter ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
        >
          모두 <span className="session-list-filter-count">{counts.all}</span>
        </button>
        <button
          type="button"
          className={`session-list-filter ${filter === 'active' ? 'active' : ''}`}
          onClick={() => setFilter('active')}
          aria-pressed={filter === 'active'}
        >
          실행 중 <span className="session-list-filter-count">{counts.active}</span>
        </button>
        <button
          type="button"
          className={`session-list-filter ${filter === 'completed' ? 'active' : ''}`}
          onClick={() => setFilter('completed')}
          aria-pressed={filter === 'completed'}
        >
          완료 <span className="session-list-filter-count">{counts.completed}</span>
        </button>
      </div>
      <div className="session-list-body">
        {filtered.length === 0 && (
          <div className="session-list-empty">{emptyText}</div>
        )}
        {filtered.map((s) => {
          const name = renames[s.sessionId] || s.name || s.agent || '이름 없음';
          const cwdShort = s.cwd ? shortCwd(s.cwd) : '';
          return (
            <button
              key={s.sessionId}
              type="button"
              className={`session-list-item ${s.sessionId === selectedId ? 'selected' : ''}`}
              onClick={() => onSelect(s)}
              title={s.cwd ? `${name}\n${s.cwd}` : name}
            >
              <span className={`session-list-dot ${dotClass(s)}`} />
              <span className="session-list-item-body">
                <span className="session-list-name">{name}</span>
                <span className="session-list-sub">
                  {cwdShort && <span className="session-list-cwd">{cwdShort}</span>}
                  <span className="session-list-time">{formatRelative(s.updatedAt, now)}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
