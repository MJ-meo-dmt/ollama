// src/components/workspaces/WorkspacePage.tsx

import { useEffect, useRef, useState } from "react"
import { SidebarLayout } from "@/components/layout/layout"
import { WorkspaceSidebar } from "./WorkspaceSidebar"
import { WorkspaceExplorer } from "./WorkspaceExplorer"
import { WorkspaceEditor } from "./WorkspaceEditor"
import { WorkspaceChat } from "./WorkspaceChat"
import { useNavigate } from "@tanstack/react-router"
import { ArrowLeftIcon } from "@heroicons/react/20/solid"
import { useSettings } from "@/hooks/useSettings"
import type { WorkspacePatchProposal } from "./patchTypes"
import { WorkspacePatchPanel } from "./WorkspacePatchPanel"
import { writeWorkspaceFile } from "./workspaceApi"

import type { WorkspaceNode } from "@/types/workspace-webview"
import {
  setWorkspaceRoot,
  readWorkspaceFile,
  readWorkspaceTree,
  selectWorkspaceDirectory,
} from "./workspaceApi"

type RecentWorkspace = {
  name: string
  path: string
  openedAt: number
}

function workspaceNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

function getRecentWorkspaces(): RecentWorkspace[] {
  try {
    return JSON.parse(localStorage.getItem("recent_workspaces") || "[]")
  } catch {
    return []
  }
}

function saveRecentWorkspace(path: string) {
  const nextWorkspace: RecentWorkspace = {
    name: workspaceNameFromPath(path),
    path,
    openedAt: Date.now(),
  }

  const existing = getRecentWorkspaces().filter((item) => item.path !== path)

  localStorage.setItem(
    "recent_workspaces",
    JSON.stringify([nextWorkspace, ...existing].slice(0, 8)),
  )
}

function findGuidance(node: WorkspaceNode): WorkspaceNode[] {
  let results: WorkspaceNode[] = []

  const name = node.name.toLowerCase()

  if (
    node.type === "file" &&
    (name === "start_here.md" || name === "context.md" || name === "rules.md" || name === "AGENTS.md")
  ) {
    results.push(node)
  }

  node.children?.forEach((child) => {
    results = results.concat(findGuidance(child))
  })

  return results
}

function applySnippetPatch(
  currentContent: string,
  originalSnippet: string,
  replacementSnippet: string,
): string | null {
  // First try exact match
  if (currentContent.includes(originalSnippet)) {
    return currentContent.replace(originalSnippet, replacementSnippet)
  }

  // Then try normalized line endings
  const normalizedCurrent = currentContent.replace(/\r\n/g, "\n")
  const normalizedOriginal = originalSnippet.replace(/\r\n/g, "\n")
  const normalizedReplacement = replacementSnippet.replace(/\r\n/g, "\n")

  if (!normalizedCurrent.includes(normalizedOriginal)) {
    return null
  }

  const updatedNormalized = normalizedCurrent.replace(
    normalizedOriginal,
    normalizedReplacement,
  )

  // Preserve original file's Windows line endings if it used CRLF
  const usesCrlf = currentContent.includes("\r\n")

  return usesCrlf
    ? updatedNormalized.replace(/\n/g, "\r\n")
    : updatedNormalized
}

export default function WorkspacePage() {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([])
  const [leftWidth, setLeftWidth] = useState(280)
  const [rightWidth, setRightWidth] = useState(420)

  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceNode | null>(null)
  const [selectedFileContent, setSelectedFileContent] = useState("")
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [guidanceFiles, setGuidanceFiles] = useState<WorkspaceNode[]>([])

  const [patchProposal, setPatchProposal] = useState<WorkspacePatchProposal | null>(null)

  const hasRestoredWorkspace = useRef(false)

  const handleBack = () => {
    navigate({ to: "/c/$chatId", params: { chatId: "new" } })
  }

  const loadWorkspaceFromPath = async (path: string) => {
    setWorkspaceError(null)
    setSelectedFile(null)
    setSelectedFileContent("")
    setGuidanceFiles([])
    setPatchProposal(null)

    const rootResult = await setWorkspaceRoot(path)

    if (!rootResult.ok || !rootResult.path) {
      setWorkspaceError(rootResult.error || "Failed to set workspace root")
      setWorkspaceTree(null)
      return
    }

    const workspaceRootPath = rootResult.path
    setWorkspacePath(workspaceRootPath)

    const treeResponse = await readWorkspaceTree(workspaceRootPath)

    if (!treeResponse.ok || !treeResponse.root) {
      setWorkspaceError(treeResponse.error || "Failed to read workspace")
      setWorkspaceTree(null)
      return
    }

    setWorkspaceTree(treeResponse.root)
    setGuidanceFiles(findGuidance(treeResponse.root))

    saveRecentWorkspace(path)
    setRecentWorkspaces(getRecentWorkspaces())
  }

  const handleOpenWorkspace = async () => {
    const dir = await selectWorkspaceDirectory()

    if (!dir) {
      return
    }

    await loadWorkspaceFromPath(dir)
  }

  const handleSelectFile = async (path: string) => {
    setSelectedFile(path)
    setWorkspaceError(null)

    const fileResponse = await readWorkspaceFile(path)

    if (!fileResponse.ok) {
      setSelectedFileContent(fileResponse.error || "Failed to read file")
      return
    }

    setSelectedFileContent(fileResponse.content || "")
  }

  const handleApplyPatch = async () => {
    if (!patchProposal) return

    const editableFiles = patchProposal.files.filter(
      (file) => file.action === "edit",
    )

    if (editableFiles.length === 0) {
      setWorkspaceError("Only edit patches are supported for now.")
      return
    }

    for (const patchFile of editableFiles) {
      const current = await readWorkspaceFile(patchFile.path)

      if (!current.ok || current.content === undefined) {
        setWorkspaceError(current.error || `Failed to read ${patchFile.path}`)
        return
      }

      const updatedContent = applySnippetPatch(
      current.content,
      patchFile.original_snippet,
      patchFile.replacement_snippet,
    )

    if (!updatedContent) {
      setWorkspaceError(
        `Original snippet not found in ${patchFile.path}. Patch was not applied.`,
      )
      return
    }

      const writeResult = await writeWorkspaceFile(
        patchFile.path,
        updatedContent,
      )

      if (!writeResult.ok) {
        setWorkspaceError(writeResult.error || `Failed to write ${patchFile.path}`)
        return
      }

      if (selectedFile === patchFile.path) {
        setSelectedFileContent(updatedContent)
      }
    }

    setPatchProposal(null)
  }

  const startLeftResize = (event: React.MouseEvent<HTMLDivElement>) => {
    const startX = event.clientX
    const startWidth = leftWidth

    const onMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = startWidth + (moveEvent.clientX - startX)
      setLeftWidth(Math.max(200, Math.min(nextWidth, 480)))
    }

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }

    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
  }

  const startRightResize = (event: React.MouseEvent<HTMLDivElement>) => {
    const startX = event.clientX
    const startWidth = rightWidth

    const onMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = startWidth - (moveEvent.clientX - startX)
      setRightWidth(Math.max(320, Math.min(nextWidth, 620)))
    }

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }

    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
  }

  useEffect(() => {
  const saved = localStorage.getItem("workspace_state")
  setRecentWorkspaces(getRecentWorkspaces())

  if (!saved) {
    hasRestoredWorkspace.current = true
    return
  }

  try {
    const parsed = JSON.parse(saved)

    if (parsed.workspacePath) {
      loadWorkspaceFromPath(parsed.workspacePath)
    }

    if (parsed.selectedFile) {
      setSelectedFile(parsed.selectedFile)

      readWorkspaceFile(parsed.selectedFile).then((res) => {
        if (res.ok) {
          setSelectedFileContent(res.content || "")
        }
      })
    }

    if (parsed.leftWidth) setLeftWidth(parsed.leftWidth)
    if (parsed.rightWidth) setRightWidth(parsed.rightWidth)
  } catch (err) {
    console.error("Failed to restore workspace state", err)
  } finally {
    hasRestoredWorkspace.current = true
  }
}, [])

useEffect(() => {
  if (!hasRestoredWorkspace.current) return

  localStorage.setItem(
    "workspace_state",
    JSON.stringify({
      workspacePath,
      selectedFile,
      leftWidth,
      rightWidth,
    }),
  )
}, [workspacePath, selectedFile, leftWidth, rightWidth])

  return (
    <SidebarLayout
      sidebar={
        <WorkspaceSidebar
          recentWorkspaces={recentWorkspaces}
          activeWorkspacePath={workspacePath}
          onSelectWorkspace={loadWorkspaceFromPath}
        />
      }
      showNewChatButton={false}
    >
      <main className="flex h-screen w-full flex-col dark:bg-neutral-900">
        <header className="w-full flex flex-none justify-between h-[52px] py-2.5 items-center border-b border-neutral-200 dark:border-neutral-800">
          <h1
            className={`flex items-center font-rounded text-md font-medium dark:text-white ${
              settings.sidebarOpen ? "pl-4" : "pl-12"
            }`}
          >
            <button
              onClick={handleBack}
              className="hover:bg-neutral-100 mr-3 dark:hover:bg-neutral-800 rounded-full p-1.5"
            >
              <ArrowLeftIcon className="w-5 h-5 dark:text-white" />
            </button>
            Workspaces
          </h1>

          <div className="mr-4 flex max-w-[60%] items-center gap-2 overflow-hidden">
            <span className="text-xs text-neutral-500">Guidance:</span>

            {guidanceFiles.length === 0 ? (
              <span className="text-xs text-neutral-400">none detected</span>
            ) : (
              guidanceFiles.map((file) => (
                <button
                  key={file.path}
                  onClick={() => handleSelectFile(file.path)}
                  className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                  title={file.relPath}
                >
                  {file.relPath || file.name}
                </button>
              ))
            )}
          </div>
        </header>

        <div
          className="flex-1 grid overflow-hidden"
          style={{
            gridTemplateColumns: `${leftWidth}px 4px minmax(0, 1fr) 4px ${rightWidth}px`,
          }}
        >
          <WorkspaceExplorer
            workspacePath={workspacePath}
            workspaceTree={workspaceTree}
            selectedFile={selectedFile}
            onOpenWorkspace={handleOpenWorkspace}
            onSelectFile={handleSelectFile}
          />

          <div
            onMouseDown={startLeftResize}
            className="cursor-col-resize bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          />

          <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">
            <WorkspaceEditor
              selectedFile={selectedFile}
              content={selectedFileContent}
              error={workspaceError}
            />
          </div>

          {patchProposal && (
            <div className="max-h-[45%] overflow-auto border-t border-neutral-200 dark:border-neutral-800">
              <WorkspacePatchPanel
                proposal={patchProposal}
                onClear={() => setPatchProposal(null)}
                onApply={handleApplyPatch}
              />
            </div>
          )}
        </div>

          <div
            onMouseDown={startRightResize}
            className="cursor-col-resize bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          />

          <WorkspaceChat
            workspacePath={workspacePath}
            selectedFile={selectedFile}
            selectedFileContent={selectedFileContent}
            guidanceFiles={guidanceFiles}
            onPatchProposal={setPatchProposal}
          />
        </div>
      </main>
    </SidebarLayout>
  )
}