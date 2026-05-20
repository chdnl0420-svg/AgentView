import { useEffect, useRef, useState } from 'react';
import { loadJSON, saveJSON, ENTER_TO_SEND_KEY } from '../lib/persistence';

const AUTOSTART_KEY = 'opt.autostart';

interface OptionsPopoverProps {
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

interface VersionInfo {
  current: string;
  latest: string | null;
  available: boolean;
  releaseUrl?: string;
}

export function OptionsPopover({ anchorEl, onClose }: OptionsPopoverProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [enterToSend, setEnterToSend] = useState<boolean>(() =>
    loadJSON<boolean>(ENTER_TO_SEND_KEY, false)
  );
  const [autostart, setAutostart] = useState<boolean>(() => loadJSON<boolean>(AUTOSTART_KEY, false));
  const [updating, setUpdating] = useState(false);

  // Lift initial version + sync autostart state from main process on mount.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const info = await window.av.updater.check();
        if (!cancelled) {
          setVersion({
            current: info.current,
            latest: info.latest,
            available: info.available,
            releaseUrl: info.releaseUrl
          });
        }
      } catch {
        if (!cancelled) {
          // Fallback: at least display the bundled version.
          const v = await window.av.updater.version().catch(() => 'unknown');
          if (!cancelled) {
            setVersion({ current: v, latest: null, available: false });
          }
        }
      }
      try {
        const sys = await window.av.options?.getAutostart?.();
        if (!cancelled && typeof sys === 'boolean') {
          setAutostart(sys);
          saveJSON(AUTOSTART_KEY, sys);
        }
      } catch {
        // ignore — IPC may not exist on older builds
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on outside click / Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!rootRef.current || !t) return;
      if (rootRef.current.contains(t)) return;
      if (anchorEl && anchorEl.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchorEl, onClose]);

  const toggleEnter = (v: boolean) => {
    setEnterToSend(v);
    saveJSON(ENTER_TO_SEND_KEY, v);
    window.dispatchEvent(new Event('opt:enterToSend'));
  };
  const toggleAutostart = async (v: boolean) => {
    setAutostart(v);
    saveJSON(AUTOSTART_KEY, v);
    try {
      await window.av.options?.setAutostart?.(v);
    } catch {
      // best-effort; UI already reflects intent
    }
  };
  const applyUpdate = async () => {
    setUpdating(true);
    try {
      await window.av.updater.download();
    } finally {
      setUpdating(false);
    }
  };
  const openRelease = () => {
    window.av.updater.openReleasePage().catch(() => {
      /* swallow */
    });
  };

  return (
    <div ref={rootRef} className="options-popover" role="dialog" aria-label="옵션">
      <header className="options-head">
        <h3>옵션</h3>
        <button type="button" className="x" aria-label="닫기" onClick={onClose}>
          ×
        </button>
      </header>

      <section className="options-row version-row">
        <div className="row-label">
          <div className="row-title">현재 버전</div>
          <div className="row-sub">v{version?.current ?? '…'}</div>
        </div>
        <div className="row-control">
          {version?.available && version.latest ? (
            <button
              type="button"
              className="btn primary small"
              disabled={updating}
              onClick={applyUpdate}
              title={`최신 버전 v${version.latest} 받기`}
            >
              {updating ? '받는 중…' : `v${version.latest} 받기`}
            </button>
          ) : (
            <span className="latest-pill" title="최신 버전입니다">
              최신
            </span>
          )}
        </div>
      </section>

      <section className="options-row">
        <div className="row-label">
          <div className="row-title">Enter 로 메시지 전송</div>
          <div className="row-sub">
            끄면 Ctrl+Enter 전송, 켜면 Enter 전송 / Shift+Enter 줄바꿈.
          </div>
        </div>
        <div className="row-control">
          <Toggle checked={enterToSend} onChange={toggleEnter} ariaLabel="Enter 로 전송" />
        </div>
      </section>

      <section className="options-row">
        <div className="row-label">
          <div className="row-title">Windows 시작 시 자동 실행</div>
          <div className="row-sub">로그인하면 AgentView 가 트레이로 떠 있습니다.</div>
        </div>
        <div className="row-control">
          <Toggle checked={autostart} onChange={toggleAutostart} ariaLabel="자동 시작" />
        </div>
      </section>

      <footer className="options-foot">
        <button type="button" className="btn ghost" onClick={openRelease}>
          릴리스 노트 보기
        </button>
      </footer>
    </div>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}

function Toggle({ checked, onChange, ariaLabel }: ToggleProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`opt-toggle ${checked ? 'on' : 'off'}`}
      onClick={() => onChange(!checked)}
    >
      <span className="knob" />
    </button>
  );
}
