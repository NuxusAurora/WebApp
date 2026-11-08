export type Course = {
  id: string;
  title: string;
  subject: string;
  textbook: string;
  learning_goal: string;
  status: 'active' | 'archived';
  created_at?: string;
  updated_at?: string;
};

export type CourseFile = { id: string; filename: string; size: number };

export function courseDate(value?: string) {
  if (!value) return '';
  const date = new Date(value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', {
    month: 'short', day: 'numeric',
  }).format(date);
}

export function fileSize(bytes: number) {
  return bytes < 1024 ? `${bytes.toLocaleString()} 字节` :
    `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(bytes / 1024)} KB`;
}
