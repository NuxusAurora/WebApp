export function AISettings(_: {
  onDirtyChange?: (dirty: boolean) => void;
  onSessionExpired?: () => void;
}) {
  return <section className="ai-settings" aria-labelledby="ai-title">
    <header className="page-heading"><div><h1 id="ai-title">模型设置</h1>
      <p>公开体验版未接入模型服务。</p></div></header>
  </section>;
}
