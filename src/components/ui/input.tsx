import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm outline-none focus:border-neutral-900",
        className,
      )}
      {...props}
    />
  );
}
