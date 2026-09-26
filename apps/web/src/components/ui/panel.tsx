import type { ReactNode } from "react";
import { cn } from "./cn";

export function Panel({
  children,
  className,
  glow,
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  as?: "section" | "div" | "article";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      {...rest}
      className={cn(
        "relative flex min-h-0 flex-col overflow-hidden rounded-[1.1rem] border border-white/[0.07] bg-[#0b0d12]/85",
        "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.045),0_20px_60px_-30px_rgba(0,0,0,0.8)] backdrop-blur-sm",
        glow && "border-brand/25 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_0_0_1px_rgba(182,240,90,0.08),0_0_60px_-20px_rgba(182,240,90,0.35)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function PanelHeader({
  icon,
  title,
  right,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex shrink-0 items-center justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <div className="flex min-w-0 items-center gap-2 text-[0.78rem] font-medium tracking-[0.14em] text-white/55 uppercase">
        {icon && <span className="text-white/40 [&>svg]:size-[0.95rem]">{icon}</span>}
        <span className="truncate">{title}</span>
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </header>
  );
}
