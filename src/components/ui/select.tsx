"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useRouteActivity } from "@/components/ui/route-activity"

const Select = SelectPrimitive.Root

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return <SelectPrimitive.Trigger
    data-slot="select-trigger"
    className={cn("inline-flex min-w-0 items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&_[data-slot=select-value]]:truncate", className)}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild><ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" /></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
}

function SelectContent({ className, children, position = "popper", sideOffset = 4, ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const routeActive = useRouteActivity()
  if (!routeActive) return null
  return <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      data-slot="select-content"
      className={cn("z-[60] max-h-(--radix-select-content-available-height) max-w-[min(90vw,480px)] min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md", className)}
      position={position}
      sideOffset={sideOffset}
      {...props}
    >
      <SelectPrimitive.Viewport className="max-h-[min(320px,var(--radix-select-content-available-height))] overflow-y-auto">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item
    data-slot="select-item"
    className={cn("relative flex min-h-8 cursor-default select-none items-center rounded-md py-1.5 pr-8 pl-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50", className)}
    {...props}
  >
    <SelectPrimitive.ItemText className="truncate">{children}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center"><CheckIcon className="size-4 text-primary" /></SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
