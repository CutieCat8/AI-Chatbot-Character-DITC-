"use client";

import type * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "./utils";

function Switch8Bit({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative peer data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-gray-300 focus-visible:border-ring focus-visible:ring-ring/50 inline-flex h-3.5 w-7 shrink-0 items-center border border-transparent shadow-xs transition-all outline-none border-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "bg-white pointer-events-none block size-3.5 data-[state=checked]:border-l data-[state=unchecked]:border-r border-foreground dark:border-ring ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%)] data-[state=unchecked]:translate-x-0",
        )}
      />

      <div
        className="absolute inset-0 border-y-2 -my-0.5 border-foreground dark:border-ring pointer-events-none"
        aria-hidden="true"
      />

      <div
        className="absolute inset-0 border-x-2 -mx-0.5 border-foreground dark:border-ring pointer-events-none"
        aria-hidden="true"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch8Bit };
