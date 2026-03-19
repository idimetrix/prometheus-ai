import * as AvatarPrimitive from "@radix-ui/react-avatar";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/utils";

function Avatar({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & {
  ref?: React.Ref<HTMLSpanElement>;
}) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

function AvatarImage({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof AvatarPrimitive.Image> & {
  ref?: React.Ref<HTMLImageElement>;
}) {
  return (
    <AvatarPrimitive.Image
      className={cn("aspect-square h-full w-full", className)}
      ref={ref}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback> & {
  ref?: React.Ref<HTMLSpanElement>;
}) {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        "flex h-full w-full items-center justify-center rounded-full bg-muted",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

export { Avatar, AvatarImage, AvatarFallback };
