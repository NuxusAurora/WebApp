import { ConnectionStatus } from '../components/connection-status';

export default function Home() {
  return <>
    <header className="topbar"><div className="brand"><span className="mark" aria-hidden="true">∑</span>学习工作台</div><span className="environment">开发环境</span></header>
    <main><div className="section-label">系统状态</div><h1>连接状态</h1><ConnectionStatus />
      <p className="footnote">课程功能准备中</p>
    </main>
    <footer>AI Structured Learning</footer>
  </>;
}
