import Link from 'next/link';
import { ConnectionStatus } from '../../components/connection-status';

export default function System() {
  return <><header className="topbar"><Link href="/" className="brand">学习工作台</Link></header>
    <main><div className="section-label">系统状态</div><h1>连接状态</h1><ConnectionStatus /></main></>;
}
