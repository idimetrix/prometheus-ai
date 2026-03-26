/** Minimal Chrome Extension API type declarations for Manifest V3 */

interface ChromeStorageArea {
  get(key: string, callback: (result: Record<string, unknown>) => void): void;
  set(items: Record<string, unknown>, callback: () => void): void;
}

interface ChromeStorage {
  local: ChromeStorageArea;
}

interface ChromeTab {
  title?: string;
  url?: string;
}

interface ChromeTabs {
  query(
    queryInfo: { active: boolean; currentWindow: boolean },
    callback: (tabs: ChromeTab[]) => void
  ): void;
}

declare const chrome:
  | {
      storage: ChromeStorage;
      tabs: ChromeTabs;
    }
  | undefined;
