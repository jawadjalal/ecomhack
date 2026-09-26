/**
 * A painting that fills its box (ported from Wayari's `Art`). Through next/image, so the originals in
 * public/art reach a phone as a small webp at the width it draws. Decorative: alt="" and aria-hidden.
 * The paintings are the founder's picks from Studio Ghibli films (see the Wayari site's DESIGN.md).
 */
import Image, { type StaticImageData } from "next/image";
import bigSky from "../../../public/art/big-sky.jpg";
import castleDusk from "../../../public/art/castle-dusk.jpg";
import castleHill from "../../../public/art/castle-hill.jpg";
import flowers from "../../../public/art/flowers.jpg";
import forestLight from "../../../public/art/forest-light.jpg";
import forestPath from "../../../public/art/forest-path.jpg";
import garden from "../../../public/art/garden.jpg";
import heroField from "../../../public/art/hero-field.jpg";
import lakeMarsh from "../../../public/art/lake-marsh.jpg";
import lanternGarden from "../../../public/art/lantern-garden.jpg";
import laputa from "../../../public/art/laputa.jpg";
import marsh from "../../../public/art/marsh.jpg";
import sea from "../../../public/art/sea.jpg";
import valley from "../../../public/art/valley.jpg";
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

/** Static imports: each painting gets a tiny blurred preview that shows at once while the sharp one loads. */
const ART: Record<ArtId, StaticImageData> = {
  "big-sky": bigSky,
  "castle-dusk": castleDusk,
  "castle-hill": castleHill,
  "flowers": flowers,
  "forest-light": forestLight,
  "forest-path": forestPath,
  "garden": garden,
  "hero-field": heroField,
  "lake-marsh": lakeMarsh,
  "lantern-garden": lanternGarden,
  "laputa": laputa,
  "marsh": marsh,
  "sea": sea,
  "valley": valley,
};

export function Art({
  id,
  position = "50% 50%",
  priority = false,
  sizes = "100vw",
  scrim,
  className,
}: {
  id: ArtId;
  /** object-position: which part of the painting stays in the box. */
  position?: string;
  priority?: boolean;
  sizes?: string;
  /** A flat (never graded) veil of the page's ink over the painting, for white type on a bright sky: Tailwind classes, e.g. "bg-[#0b2533]/15". */
  scrim?: string;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <Image src={ART[id]} alt="" fill priority={priority} sizes={sizes} quality={72} placeholder="blur" style={{ objectFit: "cover", objectPosition: position }} />
      {scrim && <div className={cn("absolute inset-0", scrim)} />}
    </div>
  );
}
