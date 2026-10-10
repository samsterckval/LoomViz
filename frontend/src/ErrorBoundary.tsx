import { Component, type ErrorInfo, type ReactNode } from "react";

// Last line of defence: a bug while rendering shows a message instead of a blank page. Unsaved
// edits are in sessionStorage (FR-8), so reloading the page doesn't lose them.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("LoomViz crashed while rendering:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="message setup">
        <h1>Something went wrong</h1>
        <p>
          LoomViz hit an unexpected error. Your unsaved edits are kept in this tab; reloading the page
          restores them.
        </p>
        <pre className="setup-error">{String(this.state.error.message || this.state.error)}</pre>
        <button className="primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}
