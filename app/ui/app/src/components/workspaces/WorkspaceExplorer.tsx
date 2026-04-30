import { useState } from "react"
import type { WorkspaceNode } from "@/types/workspace-webview"

type WorkspaceExplorerProps = {
  workspacePath: string | null
  workspaceTree: WorkspaceNode | null
  selectedFile: string | null
  onOpenWorkspace: () => void
  onSelectFile: (path: string) => void
}

type TreeNodeProps = {
  node: WorkspaceNode
  selectedFile: string | null
  onSelectFile: (path: string) => void
  expanded: Record<string, boolean>
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  depth?: number
}

function TreeNode({
  node,
  selectedFile,
  onSelectFile,
  expanded,
  setExpanded,
  depth = 0,
}: TreeNodeProps) {
  const isFile = node.type === "file"
  const isFolder = node.type === "folder"
  const isSelected = selectedFile === node.path
  const isExpanded = expanded[node.path] ?? depth === 0

  const handleClick = () => {
    if (isFolder) {
      setExpanded((prev) => ({
        ...prev,
        [node.path]: !isExpanded,
      }))
      return
    }

    onSelectFile(node.path)
  }

  return (
    <div>
      <button
        onClick={handleClick}
        className={`block w-full rounded-md px-2 py-1.5 text-left text-sm ${
          isSelected
            ? "bg-neutral-200 text-black dark:bg-neutral-700 dark:text-white"
            : "text-neutral-700 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800"
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {isFolder ? (isExpanded ? "📂 " : "📁 ") : "📄 "}
        {node.name}
      </button>

      {isFolder &&
        isExpanded &&
        node.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
            expanded={expanded}
            setExpanded={setExpanded}
            depth={depth + 1}
          />
        ))}
    </div>
  )
}

export function WorkspaceExplorer({
  workspacePath,
  workspaceTree,
  selectedFile,
  onOpenWorkspace,
  onSelectFile,
}: WorkspaceExplorerProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  return (
    <section className="h-full overflow-hidden border-r border-neutral-300 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-300 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <button
          onClick={onOpenWorkspace}
          className="w-full rounded-lg bg-black px-3 py-2 text-sm text-white dark:bg-white dark:text-black"
        >
          Open Workspace
        </button>

        <p className="mt-3 truncate text-xs text-neutral-500">
          {workspacePath || "No workspace selected"}
        </p>
      </div>

      <div className="h-[calc(100%-86px)] overflow-auto p-2">
        {workspaceTree ? (
          <TreeNode
            node={workspaceTree}
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
            expanded={expanded}
            setExpanded={setExpanded}
          />
        ) : (
          <div className="p-3 text-sm text-neutral-500">
            Select a folder to load a workspace.
          </div>
        )}
      </div>
    </section>
  )
}