import type { CSSProperties } from "react";

/** One 24 px stroke set. No icon font, no dependency, `currentColor` throughout. */
export const P = {
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z",
  left: "M15 18l-6-6 6-6",
  right: "M9 6l6 6-6 6",
  down: "M6 9l6 6 6-6",
  up: "M18 15l-6-6-6 6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  check: "M4 12.5 9 17.5 20 6.5",
  bolt: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm7-3a7 7 0 0 1-14 0M12 19v3",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  brain: "M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8V16a3 3 0 0 0 4 2.8V20h6v-1.2A3 3 0 0 0 19 16v-3.2A3 3 0 0 0 18 7a3 3 0 0 0-3-3",
  book: "M5 4h14v16H5zM9 8h6M9 12h6M9 16h4",
  gear: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z",
  credit: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  doc: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  board: "M4 5h16v11H4zM8 20h8M12 16v4",
  image: "M4 4h16v16H4zM4 16l4-4 3 3 3-3 6 6M15 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  skill: "M12 3 9.5 8.5 4 9.5l4 4-1 5.5 5-2.6 5 2.6-1-5.5 4-4-5.5-1Z",
  plug: "M9 3v6M15 3v6M6 9h12v3a6 6 0 0 1-12 0zM12 18v3",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2",
  play: "M8 5l11 7-11 7z",
  pause: "M8 5h3v14H8zM13 5h3v14h-3z",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14",
  copy: "M9 9h11v11H9zM4 15V4h11",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  send: "M4 20 21 12 4 4l3 8zM7 12h14",
  arrowUp: "M12 20V4M6 10l6-6 6 6",
  refresh: "M20 12a8 8 0 1 1-3-6.2M20 4v5h-5",
  shield: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z",
  lock: "M6 11h12v10H6zM9 11V8a3 3 0 0 1 6 0v3",
  key: "M14 10a4 4 0 1 0-3.5 4L12 15h2v2h2v2h3v-3l-5-6Z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c1-4 4-6 8-6s7 2 8 6",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2 21c.7-3.4 3.4-5 7-5s6.3 1.6 7 5M17 4.5a3.5 3.5 0 0 1 0 7M18 16c2.4.5 3.7 2.2 4 5",
  spark: "M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3.5 3.5M14.9 14.9l3.5 3.5M18.4 5.6l-3.5 3.5M9.1 14.9l-3.5 3.5",
  wave: "M3 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0",
  box: "M12 3 3 8v9l9 5 9-5V8zM3 8l9 5 9-5M12 13v9",
  link: "M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1",
  eye: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  screen: "M3 5h18v11H3zM8 20h8M12 16v4",
  hand: "M8 12V6a1.5 1.5 0 0 1 3 0v5M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-6-6v-3a1.5 1.5 0 0 1 3 0v2",
  dish: "M4 20h16M12 20a8 8 0 0 0 8-8H4a8 8 0 0 0 8 8ZM12 8V4M8 4h8",
  trend: "M3 17l5-6 4 3 6-8M15 6h4v4",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  gift: "M4 9h16v4H4zM5 13h14v8H5zM12 9v12M8.5 9a2.5 2.5 0 1 1 0-5c2 0 3.5 5 3.5 5s1.5-5 3.5-5a2.5 2.5 0 1 1 0 5",
  slash: "M5 5l14 14",
  warn: "M12 3 2.5 20h19zM12 9v5M12 17.5v.5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 7.5v.5",
  drag: "M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01",
  cpu: "M6 6h12v12H6zM9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4",
  mail: "M3 6h18v12H3zM3 7l9 7 9-7",
  phone: "M7 3h10v18H7zM11 18h2",
  sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 4v6M9 14v6",
  tag: "M20 4h-8L4 12l8 8 8-8zM8.5 8.5h.01",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  download: "M12 4v12M7 11l5 5 5-5M4 20h16",
  hash: "M9 4 7 20M17 4l-2 16M4 9h16M3 15h16",
};

export type IconName = keyof typeof P;

export function Icon({
  name,
  size = 16,
  style,
  className,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden
      className={className}
      style={style}
    >
      <path
        d={P[name]}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
