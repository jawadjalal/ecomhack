/**
 * Original, code-drawn product renders (inline SVG). No photos, no third-party artwork: every device is
 * built from rounded rectangles and gradients tinted from the product colour.
 */
import type { DeviceKind } from "@/lib/catalog";

interface Props {
  kind: DeviceKind;
  colour: string;
  /** "Pro" phones get a third lens. */
  pro?: boolean;
  className?: string;
  /** Dark tiles use a light screen glow. */
  label?: string;
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const c = (n >> shift) & 255;
    const v = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

const uid = (kind: string, colour: string, extra = "") => `${kind}-${colour.slice(1)}${extra}`;

/** A wallpaper: soft blooms tinted from the device colour. */
function Wallpaper({ id, colour }: { id: string; colour: string }) {
  return (
    <>
      <radialGradient id={`${id}-w1`} cx="30%" cy="25%" r="80%">
        <stop offset="0" stopColor={shade(colour, 0.55)} />
        <stop offset="0.45" stopColor={shade(colour, -0.1)} />
        <stop offset="1" stopColor={shade(colour, -0.75)} />
      </radialGradient>
      <radialGradient id={`${id}-w2`} cx="80%" cy="85%" r="60%">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
      </radialGradient>
    </>
  );
}

function Phone({ colour, pro }: { colour: string; pro?: boolean }) {
  const id = uid("phone", colour, pro ? "p" : "");
  const body = `url(#${id}-body)`;
  return (
    <svg viewBox="0 0 400 400" role="img" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={shade(colour, 0.28)} />
          <stop offset="0.55" stopColor={colour} />
          <stop offset="1" stopColor={shade(colour, -0.28)} />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={shade(colour, -0.35)} />
          <stop offset="0.5" stopColor={shade(colour, 0.35)} />
          <stop offset="1" stopColor={shade(colour, -0.35)} />
        </linearGradient>
        <Wallpaper id={id} colour={colour} />
        <radialGradient id={`${id}-lens`} cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#5b6b86" />
          <stop offset="0.35" stopColor="#1b1f2a" />
          <stop offset="1" stopColor="#050608" />
        </radialGradient>
        <filter id={`${id}-shadow`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="18" stdDeviation="16" floodColor="#000" floodOpacity="0.22" />
        </filter>
      </defs>
      {/* Front of the phone, behind */}
      <g transform="translate(92 36)" filter={`url(#${id}-shadow)`}>
        <rect width="150" height="310" rx="30" fill={`url(#${id}-rim)`} />
        <rect x="5" y="5" width="140" height="300" rx="26" fill="#0b0b0d" />
        <rect x="11" y="11" width="128" height="288" rx="21" fill={`url(#${id}-w1)`} />
        <rect x="11" y="11" width="128" height="288" rx="21" fill={`url(#${id}-w2)`} />
        <rect x="55" y="20" width="40" height="12" rx="6" fill="#0b0b0d" />
        <text x="75" y="92" textAnchor="middle" fontSize="38" fontWeight="600" fill="#fff" fillOpacity="0.92" fontFamily="-apple-system, system-ui, sans-serif">
          9:41
        </text>
      </g>
      {/* Back of the phone, in front */}
      <g transform="translate(168 58)" filter={`url(#${id}-shadow)`}>
        <rect width="150" height="310" rx="30" fill={`url(#${id}-rim)`} />
        <rect x="4" y="4" width="142" height="302" rx="27" fill={body} />
        <rect x="14" y="14" width={pro ? 78 : 64} height={pro ? 82 : 72} rx="20" fill={shade(colour, -0.12)} opacity="0.9" />
        <circle cx="36" cy="38" r="15" fill={`url(#${id}-lens)`} stroke={shade(colour, -0.4)} strokeWidth="3" />
        <circle cx={pro ? 36 : 36} cy={pro ? 74 : 72} r="15" fill={`url(#${id}-lens)`} stroke={shade(colour, -0.4)} strokeWidth="3" />
        {pro && <circle cx="70" cy="56" r="15" fill={`url(#${id}-lens)`} stroke={shade(colour, -0.4)} strokeWidth="3" />}
        <circle cx={pro ? 72 : 62} cy={pro ? 26 : 30} r="5" fill="#f4efe3" opacity="0.85" />
        {/* Orchard mark: a small leaf */}
        <path d="M75 150 c10 -14 26 -14 30 -12 c-2 14 -14 24 -30 22 z" fill={shade(colour, -0.2)} opacity="0.55" />
        <rect x="148" y="90" width="3" height="34" rx="1.5" fill={shade(colour, -0.4)} />
      </g>
    </svg>
  );
}

function Laptop({ colour }: { colour: string }) {
  const id = uid("laptop", colour);
  return (
    <svg viewBox="0 0 400 300" role="img" aria-hidden="true">
      <defs>
        <Wallpaper id={id} colour={colour} />
        <linearGradient id={`${id}-base`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade(colour, 0.35)} />
          <stop offset="1" stopColor={shade(colour, -0.3)} />
        </linearGradient>
        <filter id={`${id}-shadow`} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="14" stdDeviation="12" floodColor="#000" floodOpacity="0.2" />
        </filter>
      </defs>
      <g filter={`url(#${id}-shadow)`}>
        <rect x="58" y="28" width="284" height="186" rx="12" fill={shade(colour, -0.15)} />
        <rect x="63" y="33" width="274" height="176" rx="8" fill="#0b0b0d" />
        <rect x="70" y="40" width="260" height="162" rx="4" fill={`url(#${id}-w1)`} />
        <rect x="70" y="40" width="260" height="162" rx="4" fill={`url(#${id}-w2)`} />
        <rect x="180" y="33" width="40" height="7" rx="3.5" fill="#0b0b0d" />
        <path d="M30 216 h340 a4 4 0 0 1 4 4 v2 c0 6 -8 10 -18 10 H44 c-10 0 -18 -4 -18 -10 v-2 a4 4 0 0 1 4 -4 z" fill={`url(#${id}-base)`} />
        <rect x="170" y="216" width="60" height="5" rx="2.5" fill={shade(colour, -0.3)} />
      </g>
    </svg>
  );
}

function Watch({ colour }: { colour: string }) {
  const id = uid("watch", colour);
  return (
    <svg viewBox="0 0 400 400" role="img" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-band`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={shade(colour, -0.2)} />
          <stop offset="0.5" stopColor={shade(colour, 0.15)} />
          <stop offset="1" stopColor={shade(colour, -0.2)} />
        </linearGradient>
        <linearGradient id={`${id}-case`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={shade(colour, 0.4)} />
          <stop offset="1" stopColor={shade(colour, -0.35)} />
        </linearGradient>
        <filter id={`${id}-shadow`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="16" stdDeviation="14" floodColor="#000" floodOpacity="0.22" />
        </filter>
      </defs>
      <g filter={`url(#${id}-shadow)`}>
        <rect x="148" y="10" width="104" height="120" rx="18" fill={`url(#${id}-band)`} />
        <rect x="148" y="270" width="104" height="120" rx="18" fill={`url(#${id}-band)`} />
        {[300, 324, 348].map((y) => (
          <circle key={y} cx="200" cy={y} r="4" fill={shade(colour, -0.35)} />
        ))}
        <rect x="118" y="100" width="164" height="200" rx="46" fill={`url(#${id}-case)`} />
        <rect x="126" y="108" width="148" height="184" rx="40" fill="#050506" />
        <rect x="284" y="160" width="12" height="36" rx="6" fill={shade(colour, -0.1)} />
        <text x="200" y="192" textAnchor="middle" fontSize="44" fontWeight="600" fill="#fff" fontFamily="-apple-system, system-ui, sans-serif">
          10:09
        </text>
        <circle cx="160" cy="245" r="17" fill="none" stroke="#ff375f" strokeWidth="6" strokeDasharray="80 200" transform="rotate(-90 160 245)" />
        <circle cx="200" cy="245" r="17" fill="none" stroke="#9cff4f" strokeWidth="6" strokeDasharray="60 200" transform="rotate(-90 200 245)" />
        <circle cx="240" cy="245" r="17" fill="none" stroke="#3de0ff" strokeWidth="6" strokeDasharray="95 200" transform="rotate(-90 240 245)" />
      </g>
    </svg>
  );
}

function Buds({ colour }: { colour: string }) {
  const id = uid("buds", colour);
  return (
    <svg viewBox="0 0 400 320" role="img" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-case`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dcdcdc" />
        </linearGradient>
        <filter id={`${id}-shadow`} x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="12" stdDeviation="12" floodColor="#000" floodOpacity="0.18" />
        </filter>
      </defs>
      <g filter={`url(#${id}-shadow)`}>
        <rect x="120" y="70" width="170" height="140" rx="46" fill={`url(#${id}-case)`} />
        <path d="M122 118 h166" stroke="#c9c9c9" strokeWidth="2" />
        <circle cx="205" cy="160" r="4" fill="#9adf7c" />
        {/* two buds */}
        <g transform="translate(76 150) rotate(-12)">
          <ellipse cx="30" cy="30" rx="30" ry="26" fill={colour} stroke="#d7d7d7" />
          <rect x="22" y="44" width="16" height="70" rx="8" fill={colour} stroke="#d7d7d7" />
          <ellipse cx="22" cy="24" rx="10" ry="8" fill="#3a3a3c" />
        </g>
        <g transform="translate(270 150) rotate(12)">
          <ellipse cx="30" cy="30" rx="30" ry="26" fill={colour} stroke="#d7d7d7" />
          <rect x="22" y="44" width="16" height="70" rx="8" fill={colour} stroke="#d7d7d7" />
          <ellipse cx="38" cy="24" rx="10" ry="8" fill="#3a3a3c" />
        </g>
      </g>
    </svg>
  );
}

function Tablet({ colour }: { colour: string }) {
  const id = uid("tablet", colour);
  return (
    <svg viewBox="0 0 400 320" role="img" aria-hidden="true">
      <defs>
        <Wallpaper id={id} colour={colour} />
        <filter id={`${id}-shadow`} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="14" stdDeviation="12" floodColor="#000" floodOpacity="0.2" />
        </filter>
      </defs>
      <g filter={`url(#${id}-shadow)`}>
        <rect x="48" y="30" width="304" height="232" rx="22" fill={shade(colour, -0.1)} />
        <rect x="53" y="35" width="294" height="222" rx="18" fill="#0b0b0d" />
        <rect x="63" y="45" width="274" height="202" rx="10" fill={`url(#${id}-w1)`} />
        <rect x="63" y="45" width="274" height="202" rx="10" fill={`url(#${id}-w2)`} />
        <circle cx="200" cy="40" r="2.5" fill="#333" />
      </g>
    </svg>
  );
}

function Accessory({ kind, colour }: { kind: DeviceKind; colour: string }) {
  const id = uid(kind, colour);
  return (
    <svg viewBox="0 0 400 320" role="img" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor={shade(colour, -0.12)} />
        </linearGradient>
        <filter id={`${id}-shadow`} x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#000" floodOpacity="0.16" />
        </filter>
      </defs>
      <g filter={`url(#${id}-shadow)`}>
        {kind === "case" && (
          <>
            <rect x="140" y="20" width="130" height="270" rx="28" fill="#dfe8f1" fillOpacity="0.55" stroke="#b7c3cf" strokeWidth="3" />
            <rect x="152" y="32" width="66" height="72" rx="18" fill="none" stroke="#9fb0c0" strokeWidth="3" />
            <circle cx="205" cy="170" r="42" fill="none" stroke="#c4cfda" strokeWidth="3" />
          </>
        )}
        {kind === "charger" && (
          <>
            <rect x="130" y="70" width="140" height="150" rx="26" fill={`url(#${id}-g)`} stroke="#d5d5d5" />
            <rect x="170" y="150" width="60" height="12" rx="6" fill="#2a2a2c" />
            <rect x="170" y="175" width="60" height="12" rx="6" fill="#2a2a2c" />
          </>
        )}
        {kind === "cable" && (
          <>
            <path d="M120 250 C 60 170, 180 90, 220 150 S 360 180, 300 90 S 180 20, 150 70" fill="none" stroke="#efefef" strokeWidth="14" strokeLinecap="round" />
            <path d="M120 250 C 60 170, 180 90, 220 150 S 360 180, 300 90 S 180 20, 150 70" fill="none" stroke="#d0d0d0" strokeWidth="14" strokeLinecap="round" strokeDasharray="2 6" />
            <rect x="136" y="46" width="30" height="40" rx="8" fill="#e8e8e8" stroke="#c8c8c8" transform="rotate(-30 150 66)" />
            <rect x="104" y="244" width="30" height="40" rx="8" fill="#e8e8e8" stroke="#c8c8c8" transform="rotate(20 119 264)" />
          </>
        )}
      </g>
    </svg>
  );
}

export function DeviceArt({ kind, colour, pro, className, label }: Props) {
  const art =
    kind === "phone" ? (
      <Phone colour={colour} pro={pro} />
    ) : kind === "laptop" ? (
      <Laptop colour={colour} />
    ) : kind === "watch" ? (
      <Watch colour={colour} />
    ) : kind === "buds" ? (
      <Buds colour={colour} />
    ) : kind === "tablet" ? (
      <Tablet colour={colour} />
    ) : (
      <Accessory kind={kind} colour={colour} />
    );
  return (
    <div className={`device-art ${className ?? ""}`} role="img" aria-label={label}>
      {art}
    </div>
  );
}
