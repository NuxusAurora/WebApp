import type { Metadata, Viewport } from 'next';
import './globals.css';
import '../styles/ui.css';
import '../styles/course-create.css';
import '../styles/motion.css';
import '../styles/learning.css';

export const metadata: Metadata = { title: '学习工作台', description: '结构化学习工作台' };
export const viewport: Viewport = { viewportFit: 'cover', interactiveWidget: 'resizes-content' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
