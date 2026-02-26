import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Error info:', errorInfo);
    this.setState({ errorInfo });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div 
          style={{ 
            padding: '40px', 
            backgroundColor: '#0a0a1a', 
            color: '#f0f0f0',
            minHeight: '100vh',
            fontFamily: 'system-ui, sans-serif'
          }}
        >
          <h1 style={{ color: '#ef4444', marginBottom: '20px' }}>
            Something went wrong
          </h1>
          <div style={{ 
            backgroundColor: '#1a1a2e', 
            padding: '20px', 
            borderRadius: '8px',
            marginBottom: '20px'
          }}>
            <h2 style={{ color: '#f59e0b', marginBottom: '10px' }}>Error:</h2>
            <pre style={{ 
              color: '#fca5a5', 
              whiteSpace: 'pre-wrap', 
              wordBreak: 'break-word',
              fontSize: '14px'
            }}>
              {this.state.error?.message}
            </pre>
          </div>
          {this.state.errorInfo && (
            <div style={{ 
              backgroundColor: '#1a1a2e', 
              padding: '20px', 
              borderRadius: '8px'
            }}>
              <h2 style={{ color: '#f59e0b', marginBottom: '10px' }}>Stack:</h2>
              <pre style={{ 
                color: '#9ca3af', 
                whiteSpace: 'pre-wrap', 
                wordBreak: 'break-word',
                fontSize: '12px',
                maxHeight: '300px',
                overflow: 'auto'
              }}>
                {this.state.errorInfo.componentStack}
              </pre>
            </div>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '20px',
              padding: '10px 20px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
