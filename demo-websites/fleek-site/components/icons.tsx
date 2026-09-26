/** Line icons drawn for this site (24px grid). */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

export const CartIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 3.5h2.3l2.4 11.1a1.6 1.6 0 0 0 1.6 1.3h8.4a1.6 1.6 0 0 0 1.6-1.2L21 7.5H6" />
    <circle cx={9.5} cy={20} r={1.3} />
    <circle cx={17.5} cy={20} r={1.3} />
  </svg>
);
export const SearchIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2.2}>
    <circle cx={11} cy={11} r={6.5} />
    <path d="m20 20-4.2-4.2" />
  </svg>
);
export const GridIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x={4} y={4} width={6.5} height={6.5} rx={1} />
    <rect x={13.5} y={4} width={6.5} height={6.5} rx={1} />
    <rect x={4} y={13.5} width={6.5} height={6.5} rx={1} />
    <rect x={13.5} y={13.5} width={6.5} height={6.5} rx={1} />
  </svg>
);
export const TagIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.7 6.7a1.4 1.4 0 0 1-2 0z" />
    <circle cx={8} cy={8} r={1.3} />
  </svg>
);
export const UsersIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx={9} cy={8} r={3.2} />
    <path d="M3 19.5c.6-3.3 3-5.2 6-5.2s5.4 1.9 6 5.2" />
    <path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.6c1.8.6 3 2.3 3.4 4.9" />
  </svg>
);
export const SendIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 3 3 10.5l7 2.5 2.5 7z" />
    <path d="m10 13 4.5-4.5" />
  </svg>
);
export const ChevronDown = (p: P) => (
  <svg {...base(p)} strokeWidth={2}>
    <path d="m7 10 5 5 5-5" />
  </svg>
);
export const HeartIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2}>
    <path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z" />
  </svg>
);
export const DownloadIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4v10M7.5 9.8 12 14.3l4.5-4.5M4.5 16v2.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V16" />
  </svg>
);
export const ChatIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 5h16v11H9l-5 4z" />
  </svg>
);
export const BoxIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 3 8 4v10l-8 4-8-4V7z" />
    <path d="m4 7 8 4 8-4M12 11v10" />
  </svg>
);
export const ShieldIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3 4.5 6v5.5c0 4.4 3.1 8.1 7.5 9.5 4.4-1.4 7.5-5.1 7.5-9.5V6z" />
    <path d="m8.8 12 2.2 2.2 4.2-4.4" />
  </svg>
);
export const CreditIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x={3} y={6} width={18} height={12} rx={1.5} />
    <path d="M3 10h18M7 14.5h3" />
  </svg>
);
export const CheckIcon = (p: P) => (
  <svg {...base(p)} strokeWidth={2.2}>
    <path d="m5 12.5 4.2 4.2L19 7" />
  </svg>
);
export const TruckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3v3h-7" />
    <circle cx={6.5} cy={17.5} r={1.8} />
    <circle cx={16.5} cy={17.5} r={1.8} />
  </svg>
);
export const PhoneIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x={6.5} y={2.5} width={11} height={19} rx={2.2} />
    <path d="M10.5 18.5h3" />
  </svg>
);
export const PlayIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 3.5v17l14-8.5z" />
  </svg>
);

export function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span className="stars" aria-label={`${rating.toFixed(1)} out of 5`}>
      {"★★★★★".slice(0, full)}
      <span style={{ opacity: 0.3 }}>{"★★★★★".slice(full)}</span>
    </span>
  );
}
