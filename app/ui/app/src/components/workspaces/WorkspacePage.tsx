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
import { applyPatchMatch } from "./patchMatcher"
import type { PatchMatchResult } from "./patchMatcher"
import { scanWorkspaceTree } from "./workspaceScanner"
import type { GuidanceDraft, WorkspaceScanReport } from "./workspaceScanner"
import ollama from "ollama/browser"
import { useSelectedModel } from "@/hooks/useSelectedModel"

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
    (name === "start_here.md" || name === "context.md" || name === "rules.md" || name === "agents.md" || name === "style.md")
  ) {
    results.push(node)
  }

  node.children?.forEach((child) => {
    results = results.concat(findGuidance(child))
  })

  return results
}

function extractJsonObject(value: string) {
  const start = value.indexOf("{")
  const end = value.lastIndexOf("}")

  if (start === -1 || end === -1 || end <= start) {
    return null
  }

  try {
    return JSON.parse(value.slice(start, end + 1))
  } catch {
    return null
  }
}

function normalizeWorkspacePath(path: string) {
  return path.replace(/^[/\\]+/, "") // remove leading slash
}

function buildWorkspaceMap(
  node: WorkspaceNode | null,
  maxLines = 300,
): string {
  if (!node) return ""

  const lines: string[] = []

  function walk(current: WorkspaceNode, depth: number) {
    if (lines.length >= maxLines) return

    const indent = "  ".repeat(depth)
    const suffix = current.type === "folder" ? "/" : ""

    // Skip rendering empty root name weirdly
    const label = current.relPath === "" ? current.name : current.name

    lines.push(`${indent}${label}${suffix}`)

    if (current.type === "folder") {
      current.children?.forEach((child) => walk(child, depth + 1))
    }
  }

  walk(node, 0)

  if (lines.length >= maxLines) {
    lines.push("...[workspace map trimmed]")
  }

  return lines.join("\n")
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").toLowerCase()
}

function getActiveGuidanceForFile(
  allGuidanceFiles: WorkspaceNode[],
  selectedFile: string | null,
  workspacePath: string | null,
): WorkspaceNode[] {
  if (!selectedFile || !workspacePath) {
    return allGuidanceFiles.filter((file) => {
      const name = file.name.toLowerCase()
      return name === "start_here.md" || name === "agents.md" || name === "context.md" || name === "rules.md"
    })
  }

  const root = normalizePath(workspacePath)
  const selected = normalizePath(selectedFile)
  const selectedRel = selected.startsWith(root)
    ? selected.slice(root.length).replace(/^\/+/, "")
    : selected

  const selectedParts = selectedRel.split("/").filter(Boolean)
  selectedParts.pop() // remove filename

  return allGuidanceFiles.filter((file) => {
    const fileRel = normalizePath(file.relPath || file.name)
    const fileName = file.name.toLowerCase()

    const isKnownGuidance =
      fileName === "start_here.md" ||
      fileName === "agents.md" ||
      fileName === "context.md" ||
      fileName === "rules.md" ||
      fileName === "styles.md"

    if (!isKnownGuidance) return false

    // Always include root-level guidance
    if (!fileRel.includes("/")) return true

    const guidanceDir = fileRel.split("/").slice(0, -1).join("/")
    const selectedDir = selectedParts.join("/")

    // Include guidance files in parent folders of selected file
    return (
      selectedDir === guidanceDir ||
      selectedDir.startsWith(`${guidanceDir}/`)
    )
  })
}

function resolveWorkspacePath(path: string, workspacePath: string | null) {
  if (!workspacePath) return path

  const normalizedPath = path.replace(/^[/\\]+/, "")

  const looksWindowsAbsolute = /^[a-zA-Z]:[\\/]/.test(path)

  if (looksWindowsAbsolute) {
    return path
  }

  return `${workspacePath.replace(/[\\/]+$/, "")}/${normalizedPath}`
}

export default function WorkspacePage() {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([])
  const [leftWidth, setLeftWidth] = useState(280)
  const [rightWidth, setRightWidth] = useState(480)
  const [patchHeight, setPatchHeight] = useState(360)

  const [scanReport, setScanReport] = useState<WorkspaceScanReport | null>(null)
  const [showScanPanel, setShowScanPanel] = useState(() => {
    return localStorage.getItem("show_scan_panel") !== "false"
  })

  useEffect(() => {
    localStorage.setItem("show_scan_panel", String(showScanPanel))
  }, [showScanPanel])

  const { selectedModel } = useSelectedModel()
  const [guidanceDraft, setGuidanceDraft] = useState<GuidanceDraft | null>(null)
  const [isGeneratingGuidance, setIsGeneratingGuidance] = useState(false)

  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceNode | null>(null)
  const [workspaceMap, setWorkspaceMap] = useState("")
  const [selectedFileContent, setSelectedFileContent] = useState("")
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [guidanceFiles, setGuidanceFiles] = useState<WorkspaceNode[]>([])
  const [allGuidanceFiles, setAllGuidanceFiles] = useState<WorkspaceNode[]>([])

  const [patchProposal, setPatchProposal] = useState<WorkspacePatchProposal | null>(null)
  const [patchMatchResults, setPatchMatchResults] = useState<Record<string, PatchMatchResult>>({})
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null)
  const [contextRevision, setContextRevision] = useState(0)

  const hasRestoredWorkspace = useRef(false)

  const handleBack = () => {
    navigate({ to: "/c/$chatId", params: { chatId: "new" } })
  }

  const loadWorkspaceFromPath = async (path: string) => {
    setScanReport(null)
    setGuidanceDraft(null)
    setWorkspaceError(null)
    setSelectedFile(null)
    setSelectedFileContent("")
    setWorkspaceMap("")
    setGuidanceFiles([])
    setAllGuidanceFiles([])
    setPatchProposal(null)
    setPatchMatchResults({})

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
    setScanReport(scanWorkspaceTree(treeResponse.root))
    
    const detectedGuidance = findGuidance(treeResponse.root)

    setAllGuidanceFiles(detectedGuidance)
    setGuidanceFiles(
      getActiveGuidanceForFile(detectedGuidance, null, workspaceRootPath),
    )
    setWorkspaceMap(buildWorkspaceMap(treeResponse.root))

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
    setGuidanceFiles(
      getActiveGuidanceForFile(allGuidanceFiles, path, workspacePath),
    )
    setWorkspaceError(null)

    const fileResponse = await readWorkspaceFile(path)

    if (!fileResponse.ok) {
      setSelectedFileContent(fileResponse.error || "Failed to read file")
      return
    }

    setSelectedFileContent(fileResponse.content || "")
  }

  const buildPatchMatchResults = async (
    proposal: WorkspacePatchProposal,
  ): Promise<Record<string, PatchMatchResult>> => {
    const results: Record<string, PatchMatchResult> = {}

    for (const patchFile of proposal.files) {
      if (patchFile.action === "create") {
        continue
      }

      const safeRelPath = normalizeWorkspacePath(patchFile.path)
      const targetPath = resolveWorkspacePath(safeRelPath, workspacePath)

      const current = await readWorkspaceFile(targetPath)

      if (!current.ok || current.content === undefined) {
        results[patchFile.path] = {
          ok: false,
          method: "failed",
          confidence: 0,
          reason: current.error || `Failed to read ${targetPath}`,
        }
        continue
      }

      results[patchFile.path] = applyPatchMatch({
        currentContent: current.content,
        originalSnippet: patchFile.original_snippet,
        replacementSnippet: patchFile.replacement_snippet,
        anchors: patchFile.anchors,
        minConfidence: 0.65,
      })
    }

    return results
  }

  const handlePatchProposal = async (proposal: WorkspacePatchProposal) => {
    setPatchProposal(proposal)
    setPatchMatchResults({})

    const matches = await buildPatchMatchResults(proposal)

    setPatchMatchResults(matches)
  }

  const handleApplyPatch = async () => {
    if (!patchProposal) return
    console.log("Applying patch proposal", patchProposal)
    setWorkspaceNotice("Applying patch...")

    setWorkspaceError(null)
    setWorkspaceNotice("Applying patch...")

    const supportedFiles = patchProposal.files.filter(
      (file) =>
        file.action === "edit" ||
        file.action === "update" ||
        file.action === "create",
    )

    if (supportedFiles.length === 0) {
      setWorkspaceError("Only edit and create patches are supported for now.")
      return
    }

    const nextPatchMatchResults: Record<string, PatchMatchResult> = {}

    for (const patchFile of supportedFiles) {
      const safeRelPath = normalizeWorkspacePath(patchFile.path)
      const targetPath = resolveWorkspacePath(safeRelPath, workspacePath)
      if (patchFile.action === "create") {
        const existing = await readWorkspaceFile(targetPath)

        if (existing.ok) {
          setWorkspaceError(`File already exists: ${targetPath}`)
          return
        }

        const isMissingFile =
          existing.error?.toLowerCase().includes("cannot find the file") ||
          existing.error?.toLowerCase().includes("no such file") ||
          existing.error?.toLowerCase().includes("not found")

        if (!isMissingFile) {
          setWorkspaceError(existing.error || `Could not check ${targetPath}`)
          return
        }

        const writeResult = await writeWorkspaceFile(
          targetPath,
          patchFile.replacement_snippet,
        )

        if (!writeResult.ok) {
          setWorkspaceError(writeResult.error || `Failed to create ${targetPath}`)
          return
        }

        continue
      }
      const current = await readWorkspaceFile(targetPath)

      if (!current.ok || current.content === undefined) {
        setWorkspaceError(current.error || `Failed to read ${targetPath}`)
        return
      }

      console.log("Patch target:", targetPath)
      console.log("Original snippet:", patchFile.original_snippet)
      console.log("Replacement snippet:", patchFile.replacement_snippet)
      console.log("Current content:", current.content)

      const matchResult = applyPatchMatch({
        currentContent: current.content,
        originalSnippet: patchFile.original_snippet,
        replacementSnippet: patchFile.replacement_snippet,
        anchors: patchFile.anchors,
        minConfidence: 0.65,
      })

      nextPatchMatchResults[patchFile.path] = matchResult
      setPatchMatchResults({ ...nextPatchMatchResults })

      console.log("Patch match result", {
        path: targetPath,
        method: matchResult.method,
        confidence: matchResult.confidence,
        startLine: matchResult.startLine,
        endLine: matchResult.endLine,
        reason: matchResult.reason,
      })

      if (!matchResult.ok || matchResult.content === undefined) {
        setWorkspaceError(
          `Patch match failed in ${targetPath}. ${matchResult.reason || "No safe match found."}`,
        )
        return
      }

      const writeResult = await writeWorkspaceFile(
        targetPath,
        matchResult.content,
      )

      if (!writeResult.ok) {
        setWorkspaceError(writeResult.error || `Failed to write ${targetPath}`)
        return
      }

      if (selectedFile === targetPath) {
        setSelectedFileContent(matchResult.content)
      }
    }

    if (selectedFile) {
      const refreshed = await readWorkspaceFile(selectedFile)

      if (refreshed.ok) {
        setSelectedFileContent(refreshed.content || "")
      }
    }

    await reloadWorkspaceTree()

    setPatchProposal(null)
    setWorkspaceNotice("Patch applied successfully.")
    setPatchMatchResults({})
    setContextRevision((prev) => prev + 1)
    setTimeout(() => setWorkspaceNotice(null), 2500)
  }

  const handleGenerateGuidanceDraft = async () => {
    const report = scanReport || scanWorkspaceTree(workspaceTree)

    if (!report) {
      setWorkspaceError("Scan workspace first before generating guidance.")
      return
    }

    setScanReport(report)
    setGuidanceDraft(null)
    setWorkspaceError(null)
    setWorkspaceNotice("Generating guidance draft...")
    setIsGeneratingGuidance(true)

    try {
      const prompt = `You are generating guidance files for a local workspace-aware coding agent.

  The app has already scanned the workspace. Do not invent files that are not supported by the scan report.

  SCAN REPORT:
  ${JSON.stringify(report, null, 2)}

  Generate guidance files that make this project agent-ready.

  Return ONLY valid JSON with this exact shape:

  {
    "type": "guidance_draft",
    "files": [
      {
        "path": "START_HERE.md",
        "content": "markdown content"
      }
    ],
    "questions": [
      "optional question for the user"
    ]
  }

  Required files:
  - START_HERE.md
  - rules.md
  - AGENTS.md

  For this first draft, generate ONLY:
  - START_HERE.md
  - rules.md
  - AGENTS.md
  - backend/context.md if backend exists
  - frontend/context.md if frontend exists
  - docs/context.md if docs exists

  Keep each file concise.

  Rules:
  - Use paths relative to workspace root.
  - Do not overwrite project code files.
  - Do not include markdown fences around the JSON.
  - Keep guidance practical and project-specific.
  - Mention runtime/generated folders that should usually not be edited.
  - Mention source, frontend, backend, docs, data, config, and tests only if present in the scan.
  `

      const result = await ollama.generate({
        model: selectedModel?.model || "qwen3.5:9b",
        prompt,
        stream: false,
        think: false,
        format: "json",
        options: {
          temperature: 0.1,
          num_predict: 8192,
        },
      })

      const parsed = extractJsonObject(result.response) as GuidanceDraft | null

      if (
        !parsed ||
        parsed.type !== "guidance_draft" ||
        !Array.isArray(parsed.files)
      ) {
        setWorkspaceError(
            `Guidance draft response was invalid or incomplete.

          Chars returned: ${result.response.length}

          First 500 chars:
          ${result.response.slice(0, 500)}

          Last 500 chars:
          ${result.response.slice(-500)}`,
          )
        return
      }

      setGuidanceDraft(parsed)
      setWorkspaceNotice("Guidance draft generated. Review before saving.")
      setShowScanPanel(false)
    } catch (err) {
      setWorkspaceError(
        err instanceof Error ? err.message : "Failed to generate guidance draft",
      )
    } finally {
      setIsGeneratingGuidance(false)
      setTimeout(() => setWorkspaceNotice(null), 2500)
    }
  }

  const handleSaveGuidanceDraft = async () => {
    if (!guidanceDraft || !workspacePath) {
      setWorkspaceError("No guidance draft available to save.")
      return
    }

    setWorkspaceError(null)
    setWorkspaceNotice("Saving guidance files...")

    for (const file of guidanceDraft.files) {
      const safeRelPath = normalizeWorkspacePath(file.path)
      const targetPath = resolveWorkspacePath(safeRelPath, workspacePath)

      const existing = await readWorkspaceFile(targetPath)

      if (existing.ok) {
        setWorkspaceError(
          `Guidance file already exists: ${file.path}. Overwrite support will be added later.`,
        )
        setWorkspaceNotice(null)
        return
      }

      const isMissingFile =
        existing.error?.toLowerCase().includes("cannot find the file") ||
        existing.error?.toLowerCase().includes("no such file") ||
        existing.error?.toLowerCase().includes("not found")

      if (!isMissingFile) {
        setWorkspaceError(existing.error || `Could not check ${file.path}`)
        setWorkspaceNotice(null)
        return
      }

      const writeResult = await writeWorkspaceFile(targetPath, file.content)

      if (!writeResult.ok) {
        setWorkspaceError(writeResult.error || `Failed to write ${file.path}`)
        setWorkspaceNotice(null)
        return
      }
    }

    await reloadWorkspaceTree()
    setContextRevision((prev) => prev + 1)
    setGuidanceDraft(null)
    setWorkspaceNotice("Guidance files saved.")
    setTimeout(() => setWorkspaceNotice(null), 2500)
  }

  const startPatchResize = (event: React.MouseEvent<HTMLDivElement>) => {
    const startY = event.clientY
    const startHeight = patchHeight

    const onMouseMove = (moveEvent: MouseEvent) => {
      const nextHeight = startHeight - (moveEvent.clientY - startY)
      setPatchHeight(Math.max(180, Math.min(nextHeight, 720)))
    }

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }

    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
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
      setRightWidth(Math.max(360, Math.min(nextWidth, 900)))
    }

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }

    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
  }

  const reloadWorkspaceTree = async () => {
    if (!workspacePath) return

    const treeResponse = await readWorkspaceTree(workspacePath)

    if (!treeResponse.ok || !treeResponse.root) {
      setWorkspaceError(treeResponse.error || "Failed to reload workspace")
      return
    }

    setWorkspaceTree(treeResponse.root)
    setScanReport(scanWorkspaceTree(treeResponse.root))

    const detectedGuidance = findGuidance(treeResponse.root)

    setAllGuidanceFiles(detectedGuidance)
    setGuidanceFiles(
      getActiveGuidanceForFile(detectedGuidance, selectedFile, workspacePath),
    )
    setWorkspaceMap(buildWorkspaceMap(treeResponse.root))
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
      <main className="flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden dark:bg-neutral-900">
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
            <span className="text-xs text-neutral-500">Active guidance chain:</span>

            {guidanceFiles.length === 0 ? (
              <span className="text-xs text-neutral-400">none active</span>
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

            <button
              type="button"
              onClick={() => {
                setScanReport(scanWorkspaceTree(workspaceTree))
                setShowScanPanel(true)
              }}
              className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              Scan workspace
            </button>
            <button
              type="button"
              onClick={() => setShowScanPanel((prev) => !prev)}
              className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              {showScanPanel ? "Hide report" : "Show report"}
            </button>
            <button
              type="button"
              disabled={!scanReport || isGeneratingGuidance}
              onClick={handleGenerateGuidanceDraft}
              className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              {isGeneratingGuidance ? "Generating..." : "Generate guidance draft"}
            </button>
          </div>
        </header>
          {workspaceNotice && (
            <div className="border-b border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300">
              {workspaceNotice}
            </div>
          )}

          {workspaceError && (
            <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
              {workspaceError}
            </div>
          )}
        {scanReport && showScanPanel && (
          <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-3 text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300">
            <div className="mb-2 font-medium">Workspace scan</div>

            <div className="grid grid-cols-4 gap-3">
              <div>
                <div className="text-neutral-500">Files</div>
                <div className="font-mono">{scanReport.fileCount}</div>
              </div>

              <div>
                <div className="text-neutral-500">Folders</div>
                <div className="font-mono">{scanReport.folderCount}</div>
              </div>

              <div>
                <div className="text-neutral-500">Top languages</div>
                <div className="font-mono">
                  {Object.entries(scanReport.languages)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 4)
                    .map(([ext, count]) => `${ext}:${count}`)
                    .join(" ")}
                </div>
              </div>

              <div>
                <div className="text-neutral-500">Guidance</div>
                <div className="font-mono">
                  {[
                    scanReport.existingGuidance.startHere && "START",
                    scanReport.existingGuidance.agents && "AGENTS",
                    scanReport.existingGuidance.rules && "RULES",
                    scanReport.existingGuidance.contextFiles.length &&
                      `${scanReport.existingGuidance.contextFiles.length} ctx`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "none"}
                </div>
              </div>
            </div>

            <div className="mt-3">
              <div className="text-neutral-500">Likely entry points</div>
              <div className="mt-1 font-mono">
                {scanReport.likelyEntryPoints.length
                  ? scanReport.likelyEntryPoints.join(", ")
                  : "none detected"}
              </div>
            </div>

            <div className="mt-3">
              <div className="text-neutral-500">Main folders</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {scanReport.folders.slice(0, 10).map((folder) => (
                  <span
                    key={folder.path}
                    className="rounded bg-neutral-200 px-2 py-0.5 font-mono dark:bg-neutral-800"
                  >
                    {folder.path} · {folder.likelyRole} · {folder.fileCount}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {guidanceDraft && (
          <div className="max-h-[45vh] overflow-auto border-b border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="font-medium">Guidance draft preview</div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setGuidanceDraft(null)}
                  className="rounded bg-white px-2 py-1 text-xs text-blue-900 hover:bg-blue-100 dark:bg-neutral-950 dark:text-blue-200 dark:hover:bg-neutral-900"
                >
                  Clear draft
                </button>

                <button
                  type="button"
                  onClick={handleSaveGuidanceDraft}
                  className="rounded bg-blue-700 px-2 py-1 text-xs text-white hover:bg-blue-800"
                >
                  Save guidance files
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {guidanceDraft.files.map((file) => (
                <div
                  key={file.path}
                  className="rounded-lg border border-blue-200 bg-white p-3 dark:border-blue-800 dark:bg-neutral-950"
                >
                  <div className="mb-2 font-mono font-medium">{file.path}</div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-neutral-100 p-3 font-mono text-xs dark:bg-neutral-900">
                    {file.content}
                  </pre>
                </div>
              ))}
            </div>

            {guidanceDraft.questions && guidanceDraft.questions.length > 0 && (
              <div className="mt-3 rounded-lg bg-white p-3 dark:bg-neutral-950">
                <div className="font-medium">Questions</div>
                <ul className="mt-1 list-disc pl-5">
                  {guidanceDraft.questions.map((question, index) => (
                    <li key={index}>{question}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div
          className="min-h-0 flex-1 grid overflow-hidden"
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
            <>
              <div
                onMouseDown={startPatchResize}
                className="h-1.5 cursor-row-resize bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700"
              />

              <div
                className="shrink-0 overflow-auto border-t border-neutral-200 dark:border-neutral-800"
                style={{ height: `${patchHeight}px` }}
              >
                <WorkspacePatchPanel
                  proposal={patchProposal}
                  matchResults={patchMatchResults}
                  onClear={() => {
                    setPatchProposal(null)
                    setPatchMatchResults({})
                  }}
                  onApply={handleApplyPatch}
                />
              </div>
            </>
          )}
        </div>

          <div
            onMouseDown={startRightResize}
            className="cursor-col-resize bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          />

          <WorkspaceChat
            workspacePath={workspacePath}
            workspaceMap={workspaceMap}
            selectedFile={selectedFile}
            selectedFileContent={selectedFileContent}
            guidanceFiles={guidanceFiles}
            contextRevision={contextRevision}
            onPatchProposal={handlePatchProposal}
          />
        </div>
      </main>
    </SidebarLayout>
  )
}