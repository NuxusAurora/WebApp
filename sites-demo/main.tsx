import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Workspace } from './product/components/workspace';
import { STORAGE_KEY } from './product/lib/api';
import './product/globals.css';
import './demo.css';

function App() {
  const [system, setSystem] = useState(location.hash === '#system');
  useEffect(() => {
    const change = () => setSystem(location.hash === '#system');
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  function reset() {
    if (!window.confirm('清除本浏览器的体验数据，并恢复示例课程？')) return;
    try { localStorage.removeItem(STORAGE_KEY); location.hash = ''; location.reload(); }
    catch { window.alert('浏览器存储不可用，请检查网站存储权限。'); }
  }
  let storageAvailable = true;
  try { localStorage.getItem(STORAGE_KEY); } catch { storageAvailable = false; }
  return <>
    <div className="demo-bar"><span>公开体验版 · 数据仅保存在此浏览器</span><button onClick={reset}>重置体验</button></div>
    <div className="demo-root">{system ? <div className="entry-shell">
      <header className="entry-header"><a className="wordmark" href="/#">学习工作台</a><a className="quiet-link" href="/#">返回工作台</a></header>
      <main className="entry-main"><section className="account-panel"><h1>体验状态</h1>
        <p className="account-description">{storageAvailable ? '浏览器存储可用' : '浏览器存储不可用'}</p>
        <p>公开版不连接云端账户、数据库或 AI 服务。</p>
        <p className="muted">课程、昵称和文本资料只保存在当前浏览器。更换设备不会同步。</p>
        <a className="button primary" href="/#">返回工作台</a>
      </section></main>
    </div> : <Workspace testLoginEnabled />}</div>
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
