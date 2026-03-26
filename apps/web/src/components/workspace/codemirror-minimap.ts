/**
 * CodeMirror Minimap Extension
 *
 * Renders a miniature overview of the document on the right side of the editor.
 * Features:
 * - Miniature code rendering via canvas
 * - Viewport highlight showing the currently visible region
 * - Click to scroll to a position
 * - Drag viewport highlight to scroll
 * - Search highlight markers
 * - Error/warning markers
 * - Configurable width
 * - Toggle via settings
 */

import type { Extension } from "@codemirror/state";
import { StateEffect, StateField } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface MinimapOptions {
  /** Whether the minimap is initially enabled (default: true) */
  enabled?: boolean;
  /** Width of the minimap in pixels (default: 60) */
  width?: number;
}

interface MinimapMarker {
  color: string;
  line: number;
}

/* -------------------------------------------------------------------------- */
/*  State                                                                      */
/* -------------------------------------------------------------------------- */

const NON_WHITESPACE_RE = /\S/;

const toggleMinimapEffect = StateEffect.define<boolean>();
const setMinimapMarkersEffect = StateEffect.define<MinimapMarker[]>();

const minimapEnabledField = StateField.define<boolean>({
  create: () => true,
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(toggleMinimapEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

const minimapMarkersField = StateField.define<MinimapMarker[]>({
  create: () => [],
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setMinimapMarkersEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

/* -------------------------------------------------------------------------- */
/*  Theme                                                                      */
/* -------------------------------------------------------------------------- */

function createMinimapTheme(width: number): Extension {
  return EditorView.theme({
    "&": {
      position: "relative",
    },
    ".cm-minimap-container": {
      position: "absolute",
      right: "0",
      top: "0",
      bottom: "0",
      width: `${width}px`,
      backgroundColor: "rgba(24, 24, 27, 0.8)",
      borderLeft: "1px solid #27272a",
      overflow: "hidden",
      cursor: "pointer",
      zIndex: "5",
      userSelect: "none",
    },
    ".cm-minimap-canvas": {
      width: "100%",
      height: "100%",
      imageRendering: "pixelated",
    },
    ".cm-minimap-viewport": {
      position: "absolute",
      left: "0",
      right: "0",
      backgroundColor: "rgba(139, 92, 246, 0.12)",
      border: "1px solid rgba(139, 92, 246, 0.25)",
      borderRadius: "2px",
      cursor: "grab",
      "&:active": {
        cursor: "grabbing",
      },
    },
    ".cm-minimap-marker": {
      position: "absolute",
      right: "2px",
      width: "4px",
      height: "2px",
      borderRadius: "1px",
    },
    // Add padding to the right of the editor content to not overlap with minimap
    ".cm-scroller": {
      paddingRight: `${width + 4}px`,
    },
  });
}

/* -------------------------------------------------------------------------- */
/*  Minimap Renderer                                                           */
/* -------------------------------------------------------------------------- */

class MinimapRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly charWidth = 1.2;
  private readonly lineHeight = 2;
  private readonly padding = 4;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Unable to get canvas 2d context");
    }
    this.ctx = ctx;
  }

  render(
    doc: { line: (n: number) => { text: string }; lines: number },
    containerHeight: number,
    width: number
  ): void {
    const dpr = window.devicePixelRatio ?? 1;
    this.canvas.width = width * dpr;
    this.canvas.height = containerHeight * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${containerHeight}px`;

    this.ctx.scale(dpr, dpr);
    this.ctx.clearRect(0, 0, width, containerHeight);

    const totalLines = doc.lines;
    const scale = containerHeight / (totalLines * this.lineHeight);
    const effectiveLineHeight = Math.max(this.lineHeight * scale, 1);

    // Character color
    this.ctx.fillStyle = "rgba(161, 161, 170, 0.3)";

    for (let i = 1; i <= totalLines; i++) {
      const y = (i - 1) * effectiveLineHeight;
      if (y > containerHeight) {
        break;
      }

      const lineText = doc.line(i).text;
      const indent = lineText.search(NON_WHITESPACE_RE);
      const textLength = lineText.trimEnd().length;

      if (textLength > 0) {
        const x = this.padding + Math.max(0, indent) * this.charWidth;
        const lineWidth = Math.min(
          (textLength - Math.max(0, indent)) * this.charWidth,
          width - this.padding * 2 - x
        );

        if (lineWidth > 0) {
          this.ctx.fillRect(
            x,
            y,
            lineWidth,
            Math.max(effectiveLineHeight - 0.5, 0.5)
          );
        }
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Plugin                                                                     */
/* -------------------------------------------------------------------------- */

class MinimapPlugin {
  private container: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private viewport: HTMLDivElement | null = null;
  private markerContainer: HTMLDivElement | null = null;
  private renderer: MinimapRenderer | null = null;
  private readonly view: EditorView;
  private readonly width: number;
  private isDragging = false;
  private dragStartY = 0;
  private dragStartScroll = 0;
  private animFrame: number | null = null;

  constructor(view: EditorView, width: number) {
    this.view = view;
    this.width = width;
    this.createDOM();
    this.scheduleRender();
  }

  update(update: ViewUpdate): void {
    const enabled = update.state.field(minimapEnabledField);

    if (this.container) {
      this.container.style.display = enabled ? "block" : "none";
    }

    if (!enabled) {
      return;
    }

    if (update.docChanged || update.viewportChanged || update.geometryChanged) {
      this.scheduleRender();
    }

    // Update markers if changed
    if (
      update.state.field(minimapMarkersField) !==
      update.startState.field(minimapMarkersField)
    ) {
      this.renderMarkers();
    }
  }

  destroy(): void {
    if (this.animFrame !== null) {
      cancelAnimationFrame(this.animFrame);
    }
    this.container?.remove();
  }

  private createDOM(): void {
    this.container = document.createElement("div");
    this.container.className = "cm-minimap-container";

    this.canvas = document.createElement("canvas");
    this.canvas.className = "cm-minimap-canvas";
    this.container.appendChild(this.canvas);

    this.viewport = document.createElement("div");
    this.viewport.className = "cm-minimap-viewport";
    this.container.appendChild(this.viewport);

    this.markerContainer = document.createElement("div");
    this.markerContainer.style.position = "absolute";
    this.markerContainer.style.inset = "0";
    this.markerContainer.style.pointerEvents = "none";
    this.container.appendChild(this.markerContainer);

    this.renderer = new MinimapRenderer(this.canvas);

    // Click to scroll
    this.container.addEventListener("mousedown", (e) => {
      if (e.target === this.viewport) {
        this.startDrag(e);
        return;
      }

      const rect = this.container?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const ratio = (e.clientY - rect.top) / rect.height;
      const totalHeight =
        this.view.state.doc.lines * this.view.defaultLineHeight;
      const scrollTo = ratio * totalHeight - this.view.dom.clientHeight / 2;

      this.view.scrollDOM.scrollTop = Math.max(0, scrollTo);
    });

    // Append to editor DOM
    this.view.dom.appendChild(this.container);
  }

  private startDrag(e: MouseEvent): void {
    this.isDragging = true;
    this.dragStartY = e.clientY;
    this.dragStartScroll = this.view.scrollDOM.scrollTop;

    const onMove = (moveEvent: MouseEvent) => {
      if (!(this.isDragging && this.container)) {
        return;
      }

      const rect = this.container.getBoundingClientRect();
      const deltaY = moveEvent.clientY - this.dragStartY;
      const scrollRatio = deltaY / rect.height;
      const totalHeight =
        this.view.state.doc.lines * this.view.defaultLineHeight;
      const scrollDelta = scrollRatio * totalHeight;

      this.view.scrollDOM.scrollTop = this.dragStartScroll + scrollDelta;
    };

    const onUp = () => {
      this.isDragging = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  private scheduleRender(): void {
    if (this.animFrame !== null) {
      cancelAnimationFrame(this.animFrame);
    }
    this.animFrame = requestAnimationFrame(() => {
      this.renderMinimap();
      this.animFrame = null;
    });
  }

  private renderMinimap(): void {
    if (!(this.container && this.canvas && this.viewport && this.renderer)) {
      return;
    }

    const containerHeight = this.container.clientHeight;
    if (containerHeight === 0) {
      return;
    }

    // Render the miniature code
    this.renderer.render(this.view.state.doc, containerHeight, this.width);

    // Position viewport highlight
    const totalLines = this.view.state.doc.lines;
    const scrollDOM = this.view.scrollDOM;
    const totalHeight = totalLines * this.view.defaultLineHeight;

    if (totalHeight <= 0) {
      this.viewport.style.display = "none";
      return;
    }

    const scrollRatio = scrollDOM.scrollTop / totalHeight;
    const viewportRatio = scrollDOM.clientHeight / totalHeight;

    const vpTop = scrollRatio * containerHeight;
    const vpHeight = Math.max(viewportRatio * containerHeight, 20);

    this.viewport.style.display = "block";
    this.viewport.style.top = `${vpTop}px`;
    this.viewport.style.height = `${vpHeight}px`;

    // Render markers
    this.renderMarkers();
  }

  private renderMarkers(): void {
    if (!(this.markerContainer && this.container)) {
      return;
    }

    this.markerContainer.innerHTML = "";

    const markersData = this.view.state.field(minimapMarkersField);
    if (markersData.length === 0) {
      return;
    }

    const containerHeight = this.container.clientHeight;
    const totalLines = this.view.state.doc.lines;

    if (totalLines === 0 || containerHeight === 0) {
      return;
    }

    for (const marker of markersData) {
      const ratio = (marker.line - 1) / totalLines;
      const y = ratio * containerHeight;

      const el = document.createElement("div");
      el.className = "cm-minimap-marker";
      el.style.top = `${y}px`;
      el.style.backgroundColor = marker.color;
      this.markerContainer.appendChild(el);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Creates a CodeMirror minimap extension that shows a miniature overview
 * of the document on the right side.
 *
 * @param options - Configuration options
 * @returns A CodeMirror Extension
 *
 * @example
 * ```ts
 * const minimap = createMinimapExtension({ width: 60 });
 * // Include in editor extensions:
 * extensions: [minimap, ...]
 * ```
 */
export function createMinimapExtension(
  options: MinimapOptions = {}
): Extension {
  const width = options.width ?? 60;
  const enabled = options.enabled ?? true;

  const plugin = ViewPlugin.define((view) => new MinimapPlugin(view, width));

  return [
    minimapEnabledField.init(() => enabled),
    minimapMarkersField,
    plugin,
    createMinimapTheme(width),
  ];
}

/**
 * Toggle minimap visibility.
 */
export function toggleMinimap(view: EditorView): void {
  const current = view.state.field(minimapEnabledField);
  view.dispatch({ effects: toggleMinimapEffect.of(!current) });
}

/**
 * Set minimap markers (search highlights, errors, warnings).
 */
export function setMinimapMarkers(
  view: EditorView,
  markers: MinimapMarker[]
): void {
  view.dispatch({ effects: setMinimapMarkersEffect.of(markers) });
}

export type { MinimapMarker };
