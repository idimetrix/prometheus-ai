import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/utils";

const labelVariants = cva(
  "font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
);

function Label({
  className,
  ref,
  ...props
}: ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
  VariantProps<typeof labelVariants> & {
    ref?: React.Ref<HTMLLabelElement>;
  }) {
  return (
    <LabelPrimitive.Root
      className={cn(labelVariants(), className)}
      ref={ref}
      {...props}
    />
  );
}

export { Label };
