import type { Metadata } from 'next';
import './globals.css';
import '../styles/ui.css';
import '../styles/course-create.css';

export const metadata: Metadata = { title: '学习工作台', description: '结构化学习工作台' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
