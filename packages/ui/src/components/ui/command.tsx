import { type DialogProps } from "@radix-ui/react-dialog";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/utils";
import { Dialog, DialogContent } from "./dialog";

function Command({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof CommandPrimitive> & {
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <CommandPrimitive
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

function CommandDialog({ children, ...props }: DialogProps) {
  return (
    <Dialog {...props}>
      <DialogContent className="overflow-hidden p-0 shadow-lg">
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof CommandPrimitive.Input> & {
  ref?: React.Ref<HTMLInputElement>;
}) {
  return (
    <div className="flex items-center border-b px-3" cmdk-input-wrapper="">
      <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
      <CommandPrimitive.Input
        className={cn(
          "flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    </div>
  );
}

function CommandList({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof CommandPrimitive.List> & {
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <CommandPrimitive.List
      className={cn(
        "max-h-[300px] overflow-y-auto overflow-x-hidden",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

function CommandEmpty({
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof CommandPrimitive.Empty> & {
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <CommandPrimitive.Empty
      className="py-6 text-center text-sm"
      ref={ref}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof CommandPrimitive.Group> & {
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <CommandPrimitive.Group
      className={cn(
        "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:text-xs",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

function CommandItem({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof CommandPrimitive.Item> & {
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "relative flex cursor-default gap-2 select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

function CommandShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "ml-auto text-muted-foreground text-xs tracking-widest",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof CommandPrimitive.Separator> & {
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <CommandPrimitive.Separator
      className={cn("-mx-1 h-px bg-border", className)}
      ref={ref}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
