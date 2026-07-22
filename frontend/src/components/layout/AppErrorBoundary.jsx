import { Component } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Button from '../ui/Button.jsx';

class ErrorBoundaryCore extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('前端页面渲染失败', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-error-boundary">
        <div className="ui-eyebrow">页面异常</div>
        <h1>当前页面渲染失败</h1>
        <p>前端捕获到运行时错误，页面没有继续渲染。你可以返回世界总览，或刷新当前页面重新加载最新代码。</p>
        <pre>{this.state.error.message}</pre>
        <div className="app-error-actions">
          <Link to="/">
            <Button variant="primary">返回世界总览</Button>
          </Link>
          <Button onClick={() => window.location.reload()}>刷新页面</Button>
        </div>
      </main>
    );
  }
}

export default function AppErrorBoundary({ children }) {
  const location = useLocation();
  return <ErrorBoundaryCore key={location.pathname}>{children}</ErrorBoundaryCore>;
}
