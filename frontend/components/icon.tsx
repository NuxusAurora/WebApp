import type { CSSProperties } from 'react';

const paths = {
  sliders: <><path d="M3 7h5m6 0h7M3 17h11m6 0h1" /><circle cx="11" cy="7" r="3" /><circle cx="17" cy="17" r="3" /></>,
  book: <><path d="M3 4h5a7 7 0 0 1 4 1.3A7 7 0 0 1 16 4h5v15h-5a7 7 0 0 0-4 1.3A7 7 0 0 0 8 19H3z" /><path d="M12 5.3v15" /></>,
  courses: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  pulse: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
  logout: <><path d="M9 4H4v16h5M10 12h11m-4-4 4 4-4 4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  file: <><path d="M14 3H5v18h14V8zM14 3v5h5" /><path d="M8 13h8M8 17h6" /></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6" /></>,
  download: <><path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
  edit: <><path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14z" /></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  check: <path d="m5 12 4 4L19 6" />,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16v1" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  folder: <path d="M3 6V4h6l3 3h9v13H3z" />,
} as const;

export function Icon({ name, size = 20, style }: {
  name: keyof typeof paths; size?: number; style?: CSSProperties;
}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false" style={style}>{paths[name]}</svg>;
}
