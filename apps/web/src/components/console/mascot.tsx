/**
 * The assistant panel's mascots: the same animated team set as the rest of the app (see components/dw/mascot).
 * Keeps this file's API (`kind`, `size`, `active`, `thinking`, `label`); `MASCOT_CSS` is kept for old imports,
 * the animated SVGs carry their own CSS.
 */
import { Mascot as TeamMascot, type MascotKind, type MascotState } from "@/components/dw/mascot";

export type { MascotKind, MascotState };

export const MASCOT_CSS = "";

/** `active` breathes and blinks; `thinking` plays the thinking state while the agent works. */
export function Mascot({
  kind = "leader",
  size = 32,
  active = false,
  thinking = false,
  label,
  className,
}: {
  kind?: MascotKind;
  size?: number;
  active?: boolean;
  thinking?: boolean;
  label?: string;
  className?: string;
}) {
  return <TeamMascot kind={kind} size={size} active={active} state={thinking ? "thinking" : undefined} title={label} className={className} />;
}
