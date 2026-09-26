/**
 * Neutral stand-in for lifestyle photography (people, warehouses, rails of clothes). Pure CSS/SVG, so
 * no third-party photos are shipped; the box keeps the reference layout's aspect ratio.
 */
const TONES = {
  dark: ["#26231f", "#3a342d"],
  warm: ["#8c7a66", "#c9b8a2"],
  denim: ["#3f5877", "#7d93ad"],
  olive: ["#5b5f43", "#9a9a78"],
  rose: ["#a57a7a", "#dcbcb4"],
  gray: ["#d9d9d9", "#efefef"],
} as const;

export type Tone = keyof typeof TONES;

export function Placeholder({ tone = "gray", label, className, style }: { tone?: Tone; label: string; className?: string; style?: React.CSSProperties }) {
  const [a, b] = TONES[tone];
  return (
    <div
      className={`ph ${className ?? ""}`}
      role="img"
      aria-label={label}
      style={{
        background: `radial-gradient(ellipse at 65% 35%, ${b}55, transparent 60%), repeating-linear-gradient(100deg, rgba(255,255,255,.05) 0 10px, transparent 10px 28px), linear-gradient(160deg, ${b} 0%, ${a} 100%)`,
        ...style,
      }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet" style={{ width: "100%", height: "100%", opacity: 0.22 }} aria-hidden>
        <path d="M36 100 L38 62 Q40 48 50 46 Q60 48 62 62 L64 100 Z" fill="#000" />
        <circle cx={50} cy={36} r={8} fill="#000" />
      </svg>
    </div>
  );
}
