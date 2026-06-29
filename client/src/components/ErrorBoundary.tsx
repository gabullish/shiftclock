import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Without this, any render-time throw blanks the
 * whole app to a white screen with no way to recover. Here we show a friendly
 * fallback with a reload button so a user is never stranded.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep a console trace for debugging; the UI shows the friendly fallback.
    console.error("App crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-dvh w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center">
          <div className="text-3xl">😵</div>
          <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            The app hit an unexpected error and couldn't continue. Reloading usually fixes it.
            If it keeps happening, let your manager know.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
