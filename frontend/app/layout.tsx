import type { Metadata, Viewport } from 'next';
import { brandName } from '../lib/brand';
import './globals.css';
import '../styles/ui.css';
import '../styles/course-create.css';
import '../styles/motion.css';
import '../styles/learning.css';

export const metadata: Metadata = {
  title: brandName,
  applicationName: brandName,
  description: '按教材目录学习知识点、做题和复习。',
};
export const viewport: Viewport = { viewportFit: 'cover', interactiveWidget: 'resizes-content' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
