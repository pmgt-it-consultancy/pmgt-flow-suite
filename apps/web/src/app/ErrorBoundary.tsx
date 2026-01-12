import { Component, type ReactNode } from "react";

// General error boundary for catching rendering errors
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: ReactNode | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown) {
    const errorText = `${(error as any).toString()}`;
    return {
      error: (
        <>
          <p className="text-muted-foreground">Error: {errorText}</p>
        </>
      ),
    };
  }

  componentDidCatch() {}

  render() {
    if (this.state.error !== null) {
      return (
        <div className="bg-destructive/30 p-8 flex flex-col gap-4 container">
          <h1 className="text-xl font-bold">Caught an error while rendering:</h1>
          {this.state.error}
        </div>
      );
    }

    return this.props.children;
  }
}
