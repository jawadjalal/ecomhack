import type { Metadata } from "next";
import { DarwinShell } from "@/components/dw/shell";

export const metadata: Metadata = {
  title: "Darwin",
  description: "Darwin watches human and AI shoppers, finds where they drop off, tests fixes and ships the winners as pull requests.",
};

/** The Darwin app: Overview, Issues, Fixes, Experiments, Pull requests, Settings (one provider, one nav). */
export default function DarwinAppLayout({ children }: LayoutProps<"/console">) {
  return <DarwinShell>{children}</DarwinShell>;
}
