"use client";

import { useCallback, useMemo } from "react";
import type { TreeItem, TreeItemIndex } from "react-complex-tree";
import {
  StaticTreeDataProvider,
  Tree,
  UncontrolledTreeEnvironment,
} from "react-complex-tree";
import { type FileEntry, useSessionStore } from "@/stores/session.store";

const STATUS_COLORS: Record<string, string> = {
  created: "text-green-400",
  modified: "text-yellow-400",
  deleted: "text-red-400",
  read: "text-blue-400",
};

const STATUS_LABELS: Record<string, string> = {
  created: "+",
  modified: "M",
  deleted: "D",
  read: "R",
};

interface FileNodeData {
  isFolder: boolean;
  name: string;
  path: string;
  status?: string;
}

function ensureFolderPath(
  items: Record<string, TreeItem<FileNodeData>>,
  rootChildren: TreeItemIndex[],
  folderChildrenMap: Record<string, TreeItemIndex[]>,
  parts: string[]
): string {
  let currentPath = "";

  for (let i = 0; i < parts.length - 1; i++) {
    const segment = parts[i];
    if (!segment) {
      continue;
    }
    const parentPath = currentPath;
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;

    if (items[currentPath]) {
      continue;
    }

    items[currentPath] = {
      index: currentPath,
      isFolder: true,
      children: [],
      data: { name: segment, path: currentPath, isFolder: true },
    };

    if (parentPath) {
      const existing = folderChildrenMap[parentPath] ?? [];
      if (!existing.includes(currentPath)) {
        existing.push(currentPath);
      }
      folderChildrenMap[parentPath] = existing;
    } else if (!rootChildren.includes(currentPath)) {
      rootChildren.push(currentPath);
    }
  }

  return currentPath;
}

function buildTreeData(
  files: FileEntry[]
): Record<string, TreeItem<FileNodeData>> {
  const items: Record<string, TreeItem<FileNodeData>> = {};
  const rootChildren: TreeItemIndex[] = [];
  const folderChildrenMap: Record<string, TreeItemIndex[]> = {};

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sorted) {
    const parts = file.path.split("/");
    const currentPath = ensureFolderPath(
      items,
      rootChildren,
      folderChildrenMap,
      parts
    );

    const fileName = parts.at(-1) ?? file.name;
    const fileIndex = file.path;
    items[fileIndex] = {
      index: fileIndex,
      isFolder: false,
      data: {
        name: fileName,
        path: file.path,
        isFolder: false,
        status: file.status,
      },
    };

    if (currentPath) {
      const existing = folderChildrenMap[currentPath] ?? [];
      existing.push(fileIndex);
      folderChildrenMap[currentPath] = existing;
    } else {
      rootChildren.push(fileIndex);
    }
  }

  for (const [folderPath, children] of Object.entries(folderChildrenMap)) {
    if (items[folderPath]) {
      items[folderPath] = { ...items[folderPath], children };
    }
  }

  items.root = {
    index: "root",
    isFolder: true,
    children: rootChildren,
    data: { name: "root", path: "", isFolder: true },
  };

  return items;
}

export function FileTreePanel() {
  const fileTree = useSessionStore((s) => s.fileTree);
  const openFile = useSessionStore((s) => s.openFile);

  const treeData = useMemo(() => buildTreeData(fileTree), [fileTree]);

  const dataProvider = useMemo(
    () =>
      new StaticTreeDataProvider(treeData, (item, newName) => ({
        ...item,
        data: { ...item.data, name: newName },
      })),
    [treeData]
  );

  const handleSelectItems = useCallback(
    (itemIds: TreeItemIndex[]) => {
      const selected = itemIds[0];
      if (selected && treeData[selected] && !treeData[selected].isFolder) {
        const filePath = treeData[selected].data.path;
        openFile(filePath);
        window.dispatchEvent(
          new CustomEvent("prometheus:open-file", {
            detail: { path: filePath },
          })
        );
      }
    },
    [treeData, openFile]
  );

  if (fileTree.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5 text-zinc-500"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-medium text-xs text-zinc-400">Files</span>
        </div>
        <div className="flex flex-1 items-center justify-center text-xs text-zinc-600">
          No files yet
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-zinc-800 border-b px-3 py-2">
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 text-zinc-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium text-xs text-zinc-400">Files</span>
        <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {fileTree.length}
        </span>
      </div>
      <div className="rct-dark flex-1 overflow-auto p-1">
        <UncontrolledTreeEnvironment
          canDragAndDrop={false}
          canDropOnFolder={false}
          canReorderItems={false}
          dataProvider={dataProvider}
          getItemTitle={(item) => item.data.name}
          onSelectItems={handleSelectItems}
          renderItemArrow={({ item, context }) => {
            if (!item.isFolder) {
              return <span className="inline-block w-4" />;
            }
            return (
              <span className="inline-flex w-4 items-center justify-center text-zinc-500">
                {context.isExpanded ? (
                  <svg
                    aria-hidden="true"
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="m19 9-7 7-7-7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg
                    aria-hidden="true"
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="m9 5 7 7-7 7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
            );
          }}
          renderItemTitle={({ title, item }) => {
            const status = item.data.status as string | undefined;
            const statusColor = status ? STATUS_COLORS[status] : undefined;
            const statusLabel = status ? STATUS_LABELS[status] : undefined;
            return (
              <span className="flex items-center gap-1.5 font-mono text-xs">
                <span className="truncate text-zinc-300">{title}</span>
                {statusLabel && (
                  <span
                    className={`shrink-0 text-[10px] ${statusColor ?? "text-zinc-600"}`}
                  >
                    {statusLabel}
                  </span>
                )}
              </span>
            );
          }}
          viewState={{}}
        >
          <Tree
            rootItem="root"
            treeId="file-explorer"
            treeLabel="File Explorer"
          />
        </UncontrolledTreeEnvironment>
      </div>
    </div>
  );
}
