/**
 * Static Darwin mark (red crowned squircle). Not a pose — use <Mascot kind="leader"> when Darwin is acting.
 */
export function DarwinLogo({ size = 32, className, title = "Darwin" }: { size?: number; className?: string; title?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG logo, served from public/mascots
    <img
      src="/mascots/leader-logo.svg"
      width={size}
      height={size}
      alt={title}
      draggable={false}
      className={className}
      style={{ display: "block", width: size, height: size, userSelect: "none" }}
    />
  );
}
