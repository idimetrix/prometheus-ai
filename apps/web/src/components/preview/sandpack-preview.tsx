"use client";

import {
  SandpackPreview as SandpackPreviewPane,
  SandpackProvider,
} from "@codesandbox/sandpack-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface SandpackPreviewProps {
  code: string;
  dependencies?: Record<string, string>;
  theme?: "light" | "dark";
}

/**
 * Wraps a generated React component in an App.tsx entry point that renders it.
 * Includes Tailwind CSS via CDN in the index.html.
 */
function buildAppCode(_componentCode: string): string {
  return `import React from "react";
import { GeneratedComponent } from "./GeneratedComponent";

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <GeneratedComponent />
    </div>
  );
}
`;
}

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        darkMode: 'class',
        theme: {
          extend: {
            colors: {
              border: "hsl(240 3.7% 15.9%)",
              input: "hsl(240 3.7% 15.9%)",
              ring: "hsl(240 4.9% 83.9%)",
              background: "hsl(240 10% 3.9%)",
              foreground: "hsl(0 0% 98%)",
              primary: { DEFAULT: "hsl(0 0% 98%)", foreground: "hsl(240 5.9% 10%)" },
              secondary: { DEFAULT: "hsl(240 3.7% 15.9%)", foreground: "hsl(0 0% 98%)" },
              destructive: { DEFAULT: "hsl(0 62.8% 30.6%)", foreground: "hsl(0 0% 98%)" },
              muted: { DEFAULT: "hsl(240 3.7% 15.9%)", foreground: "hsl(240 5% 64.9%)" },
              accent: { DEFAULT: "hsl(240 3.7% 15.9%)", foreground: "hsl(0 0% 98%)" },
              card: { DEFAULT: "hsl(240 10% 3.9%)", foreground: "hsl(0 0% 98%)" },
            },
            borderRadius: {
              lg: "0.5rem",
              md: "calc(0.5rem - 2px)",
              sm: "calc(0.5rem - 4px)",
            },
          }
        }
      }
    </script>
    <style>
      * { border-color: hsl(240 3.7% 15.9%); }
      body { font-family: system-ui, -apple-system, sans-serif; }
    </style>
  </head>
  <body class="dark">
    <div id="root"></div>
  </body>
</html>`;

/**
 * Stub shadcn/ui component file for the sandbox.
 * Provides basic implementations so imports don't fail.
 */
const SHADCN_STUBS: Record<string, string> = {
  "/components/ui/button.tsx": `import React from "react";
export function Button({ children, className = "", variant, size, ...props }) {
  const base = "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50";
  const variants = {
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    ghost: "hover:bg-accent hover:text-accent-foreground",
    link: "text-primary underline-offset-4 hover:underline",
  };
  const sizes = { default: "h-10 px-4 py-2", sm: "h-9 rounded-md px-3", lg: "h-11 rounded-md px-8", icon: "h-10 w-10" };
  return React.createElement("button", { className: [base, variants[variant || "default"], sizes[size || "default"], className].join(" "), ...props }, children);
}`,
  "/components/ui/card.tsx": `import React from "react";
export function Card({ children, className = "", ...props }) {
  return React.createElement("div", { className: "rounded-lg border bg-card text-card-foreground shadow-sm " + className, ...props }, children);
}
export function CardHeader({ children, className = "", ...props }) {
  return React.createElement("div", { className: "flex flex-col space-y-1.5 p-6 " + className, ...props }, children);
}
export function CardTitle({ children, className = "", ...props }) {
  return React.createElement("h3", { className: "text-2xl font-semibold leading-none tracking-tight " + className, ...props }, children);
}
export function CardDescription({ children, className = "", ...props }) {
  return React.createElement("p", { className: "text-sm text-muted-foreground " + className, ...props }, children);
}
export function CardContent({ children, className = "", ...props }) {
  return React.createElement("div", { className: "p-6 pt-0 " + className, ...props }, children);
}
export function CardFooter({ children, className = "", ...props }) {
  return React.createElement("div", { className: "flex items-center p-6 pt-0 " + className, ...props }, children);
}`,
  "/components/ui/input.tsx": `import React from "react";
export function Input({ className = "", type = "text", ...props }) {
  return React.createElement("input", { type, className: "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 " + className, ...props });
}`,
  "/components/ui/label.tsx": `import React from "react";
export function Label({ children, className = "", ...props }) {
  return React.createElement("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50 " + className, ...props }, children);
}`,
  "/components/ui/badge.tsx": `import React from "react";
export function Badge({ children, className = "", variant = "default", ...props }) {
  const variants = {
    default: "bg-primary text-primary-foreground",
    secondary: "bg-secondary text-secondary-foreground",
    destructive: "bg-destructive text-destructive-foreground",
    outline: "text-foreground border",
  };
  return React.createElement("div", { className: "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors " + (variants[variant] || variants.default) + " " + className, ...props }, children);
}`,
  "/components/ui/separator.tsx": `import React from "react";
export function Separator({ className = "", orientation = "horizontal", ...props }) {
  return React.createElement("div", { role: "separator", className: (orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]") + " shrink-0 bg-border " + className, ...props });
}`,
  "/components/ui/avatar.tsx": `import React from "react";
export function Avatar({ children, className = "", ...props }) {
  return React.createElement("span", { className: "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full " + className, ...props }, children);
}
export function AvatarImage({ className = "", ...props }) {
  return React.createElement("img", { className: "aspect-square h-full w-full " + className, ...props });
}
export function AvatarFallback({ children, className = "", ...props }) {
  return React.createElement("span", { className: "flex h-full w-full items-center justify-center rounded-full bg-muted " + className, ...props }, children);
}`,
  "/components/ui/tabs.tsx": `import React, { useState } from "react";
export function Tabs({ children, defaultValue, className = "", ...props }) {
  const [value, setValue] = useState(defaultValue || "");
  return React.createElement("div", { className, ...props, "data-value": value }, React.Children.map(children, child => child ? React.cloneElement(child, { value, onValueChange: setValue }) : null));
}
export function TabsList({ children, className = "", ...props }) {
  return React.createElement("div", { className: "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground " + className, ...props }, children);
}
export function TabsTrigger({ children, value: triggerValue, className = "", onValueChange, value: currentValue, ...props }) {
  return React.createElement("button", { className: "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all " + className, onClick: () => onValueChange?.(triggerValue), ...props }, children);
}
export function TabsContent({ children, value: contentValue, className = "", value: currentValue, ...props }) {
  return React.createElement("div", { className: "mt-2 " + className, ...props }, children);
}`,
  "/components/ui/select.tsx": `import React, { useState } from "react";
export function Select({ children, ...props }) { return React.createElement("div", { className: "relative" }, children); }
export function SelectTrigger({ children, className = "", ...props }) { return React.createElement("button", { className: "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm " + className, ...props }, children); }
export function SelectValue({ placeholder, ...props }) { return React.createElement("span", props, placeholder); }
export function SelectContent({ children, ...props }) { return React.createElement("div", { className: "relative z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md" }, children); }
export function SelectItem({ children, value, ...props }) { return React.createElement("div", { className: "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none", ...props }, children); }`,
  "/components/ui/dialog.tsx": `import React from "react";
export function Dialog({ children }) { return React.createElement(React.Fragment, null, children); }
export function DialogTrigger({ children, ...props }) { return React.createElement("span", props, children); }
export function DialogContent({ children, className = "" }) { return React.createElement("div", { className: "fixed inset-0 z-50 flex items-center justify-center " + className }, React.createElement("div", { className: "bg-background rounded-lg border p-6 shadow-lg max-w-lg w-full" }, children)); }
export function DialogHeader({ children, className = "" }) { return React.createElement("div", { className: "flex flex-col space-y-1.5 text-center sm:text-left " + className }, children); }
export function DialogTitle({ children, className = "" }) { return React.createElement("h2", { className: "text-lg font-semibold leading-none tracking-tight " + className }, children); }
export function DialogDescription({ children, className = "" }) { return React.createElement("p", { className: "text-sm text-muted-foreground " + className }, children); }`,
  "/components/ui/sheet.tsx": `import React from "react";
export function Sheet({ children }) { return React.createElement(React.Fragment, null, children); }
export function SheetTrigger({ children }) { return React.createElement("span", null, children); }
export function SheetContent({ children, className = "" }) { return React.createElement("div", { className: "fixed inset-y-0 right-0 z-50 w-3/4 max-w-sm border-l bg-background p-6 shadow-lg " + className }, children); }
export function SheetHeader({ children }) { return React.createElement("div", { className: "flex flex-col space-y-2" }, children); }
export function SheetTitle({ children }) { return React.createElement("h3", { className: "text-lg font-semibold" }, children); }`,
  "/components/ui/tooltip.tsx": `import React from "react";
export function TooltipProvider({ children }) { return React.createElement(React.Fragment, null, children); }
export function Tooltip({ children }) { return React.createElement("span", null, children); }
export function TooltipTrigger({ children, ...props }) { return React.createElement("span", props, children); }
export function TooltipContent({ children }) { return React.createElement("div", { className: "z-50 rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md" }, children); }`,
};

const DEFAULT_DEPENDENCIES: Record<string, string> = {
  react: "^18.2.0",
  "react-dom": "^18.2.0",
  "lucide-react": "latest",
};

export function SandpackPreview({
  code,
  dependencies,
  theme = "dark",
}: SandpackPreviewProps) {
  const [renderSuccess, setRenderSuccess] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleMessage = useCallback((msg: MessageEvent) => {
    if (
      msg.data &&
      typeof msg.data === "object" &&
      "type" in msg.data &&
      msg.data.type === "done"
    ) {
      setRenderSuccess(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setRenderSuccess(false), 1500);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [handleMessage]);

  // Rewrite @/components/ui/* imports to relative ./components/ui/*
  const rewrittenCode = code.replace(
    /@\/components\/ui\//g,
    "./components/ui/"
  );

  const files: Record<string, string> = {
    "/App.tsx": buildAppCode(rewrittenCode),
    "/GeneratedComponent.tsx": rewrittenCode,
    "/public/index.html": INDEX_HTML,
    ...SHADCN_STUBS,
  };

  const mergedDeps = { ...DEFAULT_DEPENDENCIES, ...dependencies };

  let borderColor = "border-zinc-300";
  if (renderSuccess) {
    borderColor = "border-green-500";
  } else if (theme === "dark") {
    borderColor = "border-zinc-700";
  }

  return (
    <div
      className={`h-full w-full overflow-hidden rounded-lg border-2 transition-colors duration-300 ${borderColor}`}
    >
      <SandpackProvider
        customSetup={{
          dependencies: mergedDeps,
        }}
        files={files}
        options={{
          externalResources: ["https://cdn.tailwindcss.com"],
          visibleFiles: ["/GeneratedComponent.tsx"],
        }}
        template="react-ts"
        theme={theme}
      >
        <SandpackPreviewPane
          showNavigator={false}
          showOpenInCodeSandbox={false}
          showRefreshButton
          style={{ height: "100%" }}
        />
      </SandpackProvider>
    </div>
  );
}
