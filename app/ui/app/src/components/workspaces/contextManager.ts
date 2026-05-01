// src/components/workspaces/contextManager.ts

import type { WorkspaceNode } from "@/types/workspace-webview"
import { readWorkspaceFile } from "./workspaceApi"

const DEFAULT_RESPONSE_RESERVE = 3000
const FULL_FILE_SOFT_LIMIT = 18000
const LARGE_FILE_SUMMARY_LIMIT = 8000

export type ContextSource =
  | "guidance"
  | "selected"
  | "requested"
  | "summary"
  | "workspace_map"
  | "chat_history"

export type ContextMode = "full" | "partial" | "summary"

export type ContextFile = {
  path: string
  relPath: string
  content: string
  summary?: string
  source: ContextSource
  mode: ContextMode
  tokensEstimate: number
  rawChars: number
  priority: number
  pinned: boolean
  lastAccessed: number
  timesUsed: number
}

export type ContextBudget = {
  modelContextLength: number
  reservedForResponse: number
  availableForContext: number
  usedTokens: number
  remainingTokens: number
  percentUsed: number
}

export type BuildContextInput = {
  workspacePath: string | null
  workspaceMap: string
  selectedFile: string | null
  selectedFileContent: string
  guidanceFiles: WorkspaceNode[]
  chatHistory: string
  task: string
  command: "ask" | "plan" | "patch" | "context"
  modelContextLength: number
}

export function estimateTokens(value: string) {
  return Math.ceil(value.length / 4)
}

function now() {
  return Date.now()
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/")
}

function getRelPath(path: string, workspacePath: string | null) {
  if (!workspacePath) return normalizePath(path)

  const normalizedRoot = normalizePath(workspacePath).replace(/\/+$/, "")
  const normalizedPath = normalizePath(path)

  return normalizedPath.startsWith(normalizedRoot)
    ? normalizedPath.slice(normalizedRoot.length).replace(/^\/+/, "")
    : normalizedPath
}

function summarizeLargeFile(content: string, task: string) {
  const lines = content.split(/\r?\n/)
  const head = lines.slice(0, 80).join("\n")
  const tail = lines.slice(-60).join("\n")

  const interesting = lines
    .filter((line) =>
      /\b(function|class|type|interface|export|import|const|let|async|return|TODO|FIXME)\b/.test(
        line,
      ),
    )
    .slice(0, 180)
    .join("\n")

  return `SUMMARY GENERATED FOR LARGE FILE

Task focus:
${task || "No task provided"}

Important structural lines:
${interesting || "(none detected)"}

File opening:
${head}

File ending:
${tail}`
}

export class ContextManager {
  private files = new Map<string, ContextFile>()
  private requestedThisTurn = new Set<string>()

  clearTaskContext() {
    for (const [path, file] of this.files.entries()) {
        const name = (file.relPath || file.path).replace(/\\/g, "/").toLowerCase()

        const isRootGuidance =
        !name.includes("/") &&
        (name === "start_here.md" ||
            name === "agents.md" ||
            name === "rules.md")

        if (!isRootGuidance) {
        this.files.delete(path)
        }
    }
  }

  pruneNonRelevant(params: {
    task: string
    keepRecent?: boolean
    }) {
    const taskLower = params.task.toLowerCase()
    const keepRecent = params.keepRecent ?? true
    const recentCutoff = now() - 1000 * 60 * 10 // 10 minutes

    for (const [path, file] of this.files.entries()) {
        const relPath = (file.relPath || file.path).replace(/\\/g, "/").toLowerCase()
        const baseName = relPath.split("/").pop() || relPath
        const baseWithoutExt = baseName.replace(/\.[^.]+$/, "")
        const isPinnedOrGuidance = file.pinned || file.source === "guidance"

        const isRootGuidance =
        !relPath.includes("/") &&
        (baseName === "start_here.md" ||
            baseName === "agents.md" ||
            baseName === "rules.md")

        const isMentioned =
        taskLower.includes(baseName) ||
        taskLower.includes(baseWithoutExt) ||
        taskLower.includes(relPath)

        const isRecent =
        keepRecent && file.lastAccessed >= recentCutoff

        !isPinnedOrGuidance

        if (
        !isRootGuidance &&
        !isMentioned &&
        !isRecent &&
        !isPinnedOrGuidance
        ) {
        this.files.delete(path)
        }
    }
    }

  resetTurn() {
    this.requestedThisTurn.clear()
  }

  hasFile(path: string) {
    return this.files.has(normalizePath(path))
  }

  getLoadedFiles() {
    return Array.from(this.files.values()).sort(
      (a, b) => b.priority - a.priority,
    )
  }

  getStats(modelContextLength: number): ContextBudget {
    const usedTokens = this.getLoadedFiles().reduce(
      (sum, file) => sum + file.tokensEstimate,
      0,
    )

    const availableForContext = Math.max(
      0,
      modelContextLength - DEFAULT_RESPONSE_RESERVE,
    )

    return {
      modelContextLength,
      reservedForResponse: DEFAULT_RESPONSE_RESERVE,
      availableForContext,
      usedTokens,
      remainingTokens: Math.max(0, availableForContext - usedTokens),
      percentUsed:
        availableForContext > 0
          ? Math.min(100, Math.round((usedTokens / availableForContext) * 100))
          : 0,
    }
  }

  async loadFile(params: {
    path: string
    workspacePath: string | null
    source: ContextSource
    task: string
    pinned?: boolean
    priority?: number
  }) {
    const normalized = normalizePath(params.path)

    if (this.files.has(normalized)) {
      const existing = this.files.get(normalized)!
      existing.lastAccessed = now()
      existing.timesUsed += 1
      existing.priority = Math.max(existing.priority, params.priority ?? 50)
      return existing
    }

    const result = await readWorkspaceFile(params.path)

    if (!result.ok) {
    throw new Error(result.error || `Failed to read ${params.path}`)
    }

    const content = result.content || ""

    const shouldSummarize = content.length > FULL_FILE_SOFT_LIMIT
    const summary = shouldSummarize
      ? summarizeLargeFile(content, params.task)
      : undefined

    const effectiveContent = shouldSummarize
      ? summary!.slice(0, LARGE_FILE_SUMMARY_LIMIT)
      : content

    const file: ContextFile = {
      path: normalized,
      relPath: getRelPath(normalized, params.workspacePath),
      content: effectiveContent,
      summary,
      source: params.source,
      mode: shouldSummarize ? "summary" : "full",
      tokensEstimate: estimateTokens(effectiveContent),
      rawChars: content.length,
      priority: params.priority ?? this.getBasePriority(params.source),
      pinned: Boolean(params.pinned),
      lastAccessed: now(),
      timesUsed: 1,
    }

    this.files.set(normalized, file)
    return file
  }

  registerSelectedFile(params: {
    path: string
    content: string
    workspacePath: string | null
    task: string
  }) {
    const normalized = normalizePath(params.path)
    const shouldSummarize = params.content.length > FULL_FILE_SOFT_LIMIT

    const effectiveContent = shouldSummarize
      ? summarizeLargeFile(params.content, params.task)
      : params.content

    const file: ContextFile = {
      path: normalized,
      relPath: getRelPath(normalized, params.workspacePath),
      content: effectiveContent,
      summary: shouldSummarize ? effectiveContent : undefined,
      source: "selected",
      mode: shouldSummarize ? "summary" : "full",
      tokensEstimate: estimateTokens(effectiveContent),
      rawChars: params.content.length,
      priority: 95,
      pinned: false,
      lastAccessed: now(),
      timesUsed: 1,
    }

    this.files.set(normalized, file)
    }

    private isGuidanceRelevantToFile(
    guidanceRelPath: string,
    selectedFile: string,
    workspacePath: string | null,
    ) {
    const selectedRelPath = getRelPath(selectedFile, workspacePath)
    const selectedParts = normalizePath(selectedRelPath).split("/").filter(Boolean)

    selectedParts.pop()

    const selectedDir = selectedParts.join("/")
    const guidanceDir = normalizePath(guidanceRelPath)
        .split("/")
        .slice(0, -1)
        .join("/")

    if (!guidanceDir) return true

    return (
        selectedDir === guidanceDir ||
        selectedDir.startsWith(`${guidanceDir}/`)
    )
    }

  async loadGuidanceFiles(params: {
    files: WorkspaceNode[]
    workspacePath: string | null
    task: string
    selectedFile?: string | null
    }) {
    for (const file of params.files.slice(0, 12)) {
        const name = file.name.toLowerCase()
        const relPath = normalizePath(file.relPath || file.name)

        const isRootGuidance =
        !relPath.includes("/") &&
        (name === "start_here.md" ||
            name === "agents.md" ||
            name === "rules.md")

        const isFolderGuidanceRelevant =
        params.selectedFile &&
        this.isGuidanceRelevantToFile(
            relPath,
            params.selectedFile,
            params.workspacePath,
        )

        if (!isRootGuidance && !isFolderGuidanceRelevant) {
        continue
        }

        await this.loadFile({
        path: file.path,
        workspacePath: params.workspacePath,
        source: "guidance",
        task: params.task,
        pinned: isRootGuidance,
        priority: this.getGuidancePriority(file.name),
        })
    }
    }

  markRequested(path: string) {
    this.requestedThisTurn.add(normalizePath(path))
  }

  wasRequestedThisTurn(path: string) {
    return this.requestedThisTurn.has(normalizePath(path))
  }

  buildPromptContext(modelContextLength: number) {
    const budget = this.getStats(modelContextLength)
    const available = budget.availableForContext

    const ordered = this.getLoadedFiles().sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.priority - a.priority
    })

    const selected: ContextFile[] = []
    let used = 0

    for (const file of ordered) {
      if (file.pinned || used + file.tokensEstimate <= available) {
        selected.push(file)
        used += file.tokensEstimate
      }
    }

    return selected
      .map((file) => this.formatFile(file))
      .join("\n\n")
  }

  private formatFile(file: ContextFile) {
    return `--- ${file.relPath || file.path} ---
SOURCE: ${file.source}
STATUS: ${file.mode.toUpperCase()}
RAW CHARS: ${file.rawChars}
TOKENS ESTIMATE: ${file.tokensEstimate}
PRIORITY: ${file.priority}

${file.content}`
  }

  private getBasePriority(source: ContextSource) {
    switch (source) {
      case "guidance":
        return 100
      case "selected":
        return 95
      case "requested":
        return 80
      case "summary":
        return 65
      case "workspace_map":
        return 60
      case "chat_history":
        return 40
      default:
        return 50
    }
  }

  private getGuidancePriority(name: string) {
    const lower = name.toLowerCase()

    if (lower === "start_here.md") return 100
    if (lower === "agents.md") return 95
    if (lower === "rules.md") return 90
    if (lower === "context.md") return 85
    if (lower === "style.md" || lower === "styles.md") return 70

    return 60
  }
}