import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * Keeps a crash in one page from blanking the whole app. Mounted with
 * `key={pathname}`, so switching tabs always renders the new page fresh —
 * no refresh needed — and "Try again" re-renders the current one.
 */
export class RouteErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("page crashed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-card p-6 text-center">
        <h1 className="font-display text-lg font-semibold text-ink">Something went wrong on this page</h1>
        <p className="mt-2 font-mono text-xs break-words text-faint">{this.state.error.message}</p>
        <button
          onClick={() => this.setState({ error: null })}
          className="mt-4 h-10 rounded-xl bg-accentfill px-4 text-sm font-semibold text-onaccent"
        >
          Try again
        </button>
      </div>
    );
  }
}
