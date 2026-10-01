import type { ComponentProps, ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

export function AuthShell({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-x-hidden bg-background px-5 py-12">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse at top, rgba(245,229,227,0.7) 0%, transparent 55%)",
        }}
        aria-hidden
      />
      <div className="relative z-10 flex w-full max-w-[440px] flex-col items-center">
        {children}
        {footer}
      </div>
    </div>
  );
}

export function AuthCard({
  children,
  className,
  ...props
}: {
  children: ReactNode;
  className?: string;
} & Omit<ComponentProps<typeof Card>, "children" | "padding">) {
  return (
    <Card
      padding="lg"
      className={cn("w-full max-w-[440px]", className)}
      {...props}
    >
      {children}
    </Card>
  );
}

export function AuthBrand({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-8 text-center">
      <p className="text-[11px] tracking-[0.22em] text-secondary-text">BEAUTY OS</p>
      <h1 className="mt-2 font-display text-3xl tracking-[0.16em] text-primary sm:text-4xl">
        Beauty OS
      </h1>
      <p className="mt-2 text-xs tracking-[0.18em] text-secondary-text">
        美容師工作台
      </p>
      <p className="mt-5 text-base font-medium text-text">{title}</p>
      {description ? (
        <p className="mt-2 text-sm leading-relaxed text-secondary-text">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export function AuthAlert({
  tone,
  title,
  description,
}: {
  tone: "error" | "success";
  title: string;
  description?: string;
}) {
  return (
    <div
      role="alert"
      className={
        tone === "success"
          ? "rounded-2xl bg-[#E7F0EA] px-4 py-3 text-sm leading-relaxed text-[#5C7F66]"
          : "rounded-2xl bg-[#F7E8E8] px-4 py-3 text-sm leading-relaxed text-[#B15B5B]"
      }
    >
      <p className="font-medium">{title}</p>
      {description ? <p className="mt-1">{description}</p> : null}
    </div>
  );
}
