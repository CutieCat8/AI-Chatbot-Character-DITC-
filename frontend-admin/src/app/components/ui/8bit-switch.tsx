"use client";

import type * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "./utils";

function Switch8Bit({
  className,
  style,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "group relative inline-flex h-4 w-7 shrink-0 bg-transparent outline-none transition-[filter,opacity] focus-visible:drop-shadow-[0_0_0.2rem_var(--ring)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      style={style}
      {...props}
    >
      <span
        className="pointer-events-none absolute inset-[2px] bg-gray-300 transition-colors group-data-[state=checked]:bg-emerald-500"
        aria-hidden="true"
      />

      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none absolute left-[2px] top-[2px] z-10 block h-3 w-3 bg-white ring-0 transition-transform data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0",
        )}
      />

      <svg
        viewBox="0 0 28 16"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 z-20 size-full text-foreground"
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M2 0H26V2H28V14H26V16H2V14H0V2H2V0ZM2 2V14H26V2H2Z"
        />
      </svg>
      <span className="pointer-events-none absolute bottom-[2px] left-1/2 top-[2px] z-20 w-px -translate-x-1/2 bg-foreground" aria-hidden="true" />
    </SwitchPrimitive.Root>
  );
}

export { Switch8Bit };
