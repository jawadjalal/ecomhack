/**
 * A painting that fills its box (ported from Wayari's `Art`). Through next/image, so the originals in
 * public/art reach a phone as a small webp at the width it draws. Decorative: alt="" and aria-hidden.
 * The paintings are the founder's picks from Studio Ghibli films (see the Wayari site's DESIGN.md).
 */
import Image from "next/image";
import { cn } from "@/components/ui/cn";

export type ArtId =
  | "big-sky"
  | "castle-dusk"
  | "castle-hill"
  | "flowers"
  | "forest-light"
  | "forest-path"
  | "garden"
  | "hero-field"
  | "lake-marsh"
  | "lantern-garden"
  | "laputa"
  | "marsh"
  | "sea"
  | "valley";

export function Art({
  id,
  position = "50% 50%",
  priority = false,
  sizes = "100vw",
  className,
}: {
  id: ArtId;
  /** object-position: which part of the painting stays in the box. */
  position?: string;
  priority?: boolean;
  sizes?: string;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <Image src={`/art/${id}.jpg`} alt="" fill priority={priority} sizes={sizes} style={{ objectFit: "cover", objectPosition: position }} />
    </div>
  );
}
