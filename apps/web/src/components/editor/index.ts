export { DiffEditorPanel } from "./diff-editor";
export { EditorPanel } from "./editor-panel";
export {
  addTabToGroup,
  createInitialSplitState,
  type EditorTab,
  EditorTabs,
  handleTabContextAction,
  removeTabFromGroup,
  reorderTabsInGroup,
  type SplitDirection,
  type SplitEditorState,
  type SplitNode,
  splitGroup,
  type TabContextAction,
  type TabGroup,
  togglePinTab,
} from "./editor-tabs";
export {
  EditorFileTree,
  type FileTreeNode,
} from "./file-tree";
export {
  detectLanguage,
  type EditorFile,
  MonacoEditor,
} from "./monaco-editor";
