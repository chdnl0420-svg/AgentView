// Top-level React error boundary so a render failure inside any subtree
// surfaces as a friendly recovery screen instead of a blank window.
// Researcher item #466: React Error Boundary 전체 적용.

import React from 'react';

interface State {
  error: Error | null;
}

interface Props {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Surface to the dev console so the underlying stack is still
    // accessible. Production logging hook can be added later.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private readonly reset = (): void => this.setState({ error: null });

  render(): React.ReactNode {
    const err = this.state.error;
    if (err) {
      return (
        <div className="error-boundary" role="alert" aria-live="assertive">
          <div className="error-boundary-icon" aria-hidden="true">⚠</div>
          <h2 className="error-boundary-title">예상치 못한 오류가 발생했어요</h2>
          <p className="error-boundary-hint">
            잠시 후 다시 시도해 보시고, 같은 오류가 반복되면 앱을 새로 고침해 주세요.
          </p>
          <pre className="error-boundary-detail">{err.message}</pre>
          <div className="error-boundary-actions">
            <button type="button" className="btn primary" onClick={this.reset}>
              다시 시도
            </button>
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              앱 새로 고침
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
