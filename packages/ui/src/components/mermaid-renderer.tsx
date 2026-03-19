"use client";

import { useEffect, useId, useRef, useState } from "react";

interface MermaidRendererProps {
  chart: string;
  className?: string;
}

export function MermaidRenderer({ chart, className }: MermaidRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uniqueId = useId().replace(/:/g, "-");

  useEffect(() => {
    let cancelled = false;

    const renderChart = async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            darkMode: true,
            background: "#09090b",
            primaryColor: "#7c3aed",
            primaryTextColor: "#e4e4e7",
            primaryBorderColor: "#3f3f46",
            lineColor: "#52525b",
            secondaryColor: "#18181b",
            tertiaryColor: "#27272a",
          },
          // securityLevel strict ensures mermaid sanitizes its output
          securityLevel: "strict",
        });

        const { svg: rendered } = await mermaid.render(
          `mermaid-${uniqueId}`,
          chart
        );

        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Failed to render diagram";
          setError(message);
          setSvg(null);
        }
      }
    };

    renderChart();

    return () => {
      cancelled = true;
    };
  }, [chart, uniqueId]);

  // Write the sanitized SVG (from mermaid strict mode) into the container
  useEffect(() => {
    if (svg && containerRef.current) {
      containerRef.current.textContent = "";
      const parser = new DOMParser();
      const doc = parser.parseFromString(svg, "image/svg+xml");
      const svgElement = doc.documentElement;
      svgElement.style.maxWidth = "100%";
      containerRef.current.appendChild(document.importNode(svgElement, true));
    }
  }, [svg]);

  if (error) {
    return (
      <div className={className}>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <div className="mb-2 text-red-400 text-xs">
            Failed to render diagram
          </div>
          <pre className="overflow-x-auto font-mono text-xs text-zinc-400">
            <code>{chart}</code>
          </pre>
        </div>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className={className}>
        <div className="flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 p-6">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          <span className="ml-2 text-xs text-zinc-500">
            Rendering diagram...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="flex items-center justify-center" ref={containerRef} />
      </div>
    </div>
  );
}
