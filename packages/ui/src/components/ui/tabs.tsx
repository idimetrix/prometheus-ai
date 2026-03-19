import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/utils";

const Tabs = TabsPrimitive.Root;

function TabsList({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 font-medium text-sm ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Content> & {
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <TabsPrimitive.Content
      className={cn(
        "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
