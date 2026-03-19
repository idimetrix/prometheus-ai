import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/utils";
import { buttonVariants } from "./button";

const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
const AlertDialogPortal = AlertDialogPrimitive.Portal;

function AlertDialogOverlay({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay> & {
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <AlertDialogPrimitive.Overlay
      className={cn(
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80 data-[state=closed]:animate-out data-[state=open]:animate-in",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> & {
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        className={cn(
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] fixed top-[50%] left-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in sm:rounded-lg",
          className,
        )}
        ref={ref}
        {...props}
      />
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col space-y-2 text-center sm:text-left",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title> & {
  ref?: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <AlertDialogPrimitive.Title
      className={cn("font-semibold text-lg", className)}
      ref={ref}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description> & {
  ref?: React.Ref<HTMLParagraphElement>;
}) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      ref={ref}
      {...props}
    />
  );
}

function AlertDialogAction({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action> & {
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <AlertDialogPrimitive.Action
      className={cn(buttonVariants(), className)}
      ref={ref}
      {...props}
    />
  );
}

function AlertDialogCancel({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel> & {
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <AlertDialogPrimitive.Cancel
      className={cn(
        buttonVariants({ variant: "outline" }),
        "mt-2 sm:mt-0",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
