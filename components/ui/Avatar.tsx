import { cn } from "@/lib/utils";

interface AvatarProps {
  initials: string;
  name?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "h-9 w-9 text-sm",
  md: "h-11 w-11 text-base",
  lg: "h-14 w-14 text-lg",
};

export function Avatar({ initials, name, size = "md", className }: AvatarProps) {
  return (
    <div className={cn("inline-flex items-center gap-3", className)}>
      <div
        className={cn(
          "inline-flex items-center justify-center rounded-full bg-primary-light font-medium text-primary",
          sizeClasses[size],
        )}
        aria-hidden
      >
        {initials}
      </div>
      {name ? <span className="text-sm font-medium text-text">{name}</span> : null}
    </div>
  );
}
