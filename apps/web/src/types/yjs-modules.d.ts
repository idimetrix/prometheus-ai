/**
 * Type declarations for optional Yjs collaborative editing packages.
 * These modules are dynamically imported and may not be installed.
 */

declare module "yjs" {
  export class Doc {
    clientID: number;
    getText(name: string): Text;
    destroy(): void;
  }

  export class Text {
    length: number;
    insert(index: number, content: string): void;
    toString(): string;
    observe(callback: () => void): void;
  }

  export class UndoManager {
    constructor(scope: Text);
  }
}

declare module "y-websocket" {
  import type { Doc } from "yjs";

  interface WebsocketProviderOptions {
    connect?: boolean;
  }

  interface Awareness {
    getStates(): Map<number, Record<string, unknown>>;
    on(event: string, callback: () => void): void;
    setLocalStateField(field: string, value: unknown): void;
  }

  export class WebsocketProvider {
    awareness: Awareness;
    constructor(
      serverUrl: string,
      roomname: string,
      doc: Doc,
      opts?: WebsocketProviderOptions
    );
    on(event: string, callback: (event: { status: string }) => void): void;
    disconnect(): void;
    destroy(): void;
  }
}

declare module "y-codemirror.next" {
  import type { Extension } from "@codemirror/state";
  import type { Text, UndoManager } from "yjs";

  interface YCollabOptions {
    undoManager?: UndoManager;
  }

  export function yCollab(
    ytext: Text,
    awareness: unknown,
    options?: YCollabOptions
  ): Extension;
}
