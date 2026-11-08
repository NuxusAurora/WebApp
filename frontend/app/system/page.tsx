import Link from 'next/link';
import { ConnectionStatus } from '../../components/connection-status';
import { Icon } from '../../components/icon';

export default function System() {
  return <div className="application-shell">
    <a href="#main-content" className="skip-link">跳到主要内容</a>
    <aside className="app-sidebar">
      <Link className="wordmark" href="/"><span className="brand-symbol"><Icon name="book" size={23} /></span>学习工作台</Link>
      <nav className="primary-nav" aria-label="主导航">
        <Link className="nav-item" href="/"><Icon name="courses" /><span>我的课程</span></Link>
        <Link className="nav-item is-current" href="/system" aria-current="page"><Icon name="pulse" /><span>连接状态</span></Link>
      </nav>
    </aside>
    <div className="app-body">
      <header className="workspace-topbar"><div className="breadcrumb"><span>个人空间</span><Icon name="chevron" size={14} /><strong>连接状态</strong></div>
        <Link className="quiet-link" href="/">返回工作台<Icon name="arrow" size={16} /></Link></header>
      <main id="main-content" className="workspace-main">
        <div className="status-page"><div className="page-heading"><div><h1>连接状态</h1>
          <p>查看工作台与基础服务的连接情况。</p></div></div><ConnectionStatus /></div>
      </main>
    </div>
  </div>;
}
