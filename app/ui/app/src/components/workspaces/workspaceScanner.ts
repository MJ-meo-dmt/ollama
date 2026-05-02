// src/components/workspaces/workspaceScanner.ts

import type { WorkspaceNode } from "@/types/workspace-webview"

export type FolderRole =
  | "source"
  | "backend"
  | "frontend"
  | "docs"
  | "tests"
  | "config"
  | "assets"
  | "data"
  | "runtime"
  | "scripts"
  | "routes"
  | "components"
  | "unknown"

export type WorkspaceScanReport = {
  rootName: string
  fileCount: number
  folderCount: number
  languages: Record<string, number>
  keyFiles: {
    packageJson?: string
    tsconfig?: string
    viteConfig?: string
    readme?: string
    gitignore?: string
    envExamples: string[]
    goMod?: string
    pyProject?: string
    cargoToml?: string
    requirementsTxt?: string
  }
  folders: {
    path: string
    fileCount: number
    likelyRole: FolderRole
  }[]
  likelyEntryPoints: string[]
  existingGuidance: {
    startHere?: string
    agents?: string
    rules?: string
    contextFiles: string[]
  }
  ignoredHints: string[]
}

export type GuidanceDraftFile = {
  path: string
  content: string
}

export type GuidanceDraft = {
  type: "guidance_draft"
  files: GuidanceDraftFile[]
  questions?: string[]
}

function getExt(path: string) {
  const name = path.toLowerCase()
  const index = name.lastIndexOf(".")
  return index === -1 ? "" : name.slice(index)
}

function roleFromPath(path: string): FolderRole {
  const lower = path.toLowerCase()

  if (lower.includes("session") || lower.includes("cache") || lower.includes("tmp")) {
    return "runtime"
  }

  if (
    lower.includes("test") ||
    lower.includes("spec") ||
    lower.includes("__tests__")
  ) {
    return "tests"
  }

  if (
    lower === "docs" ||
    lower.includes("/docs") ||
    lower.includes("documentation")
  ) {
    return "docs"
  }

  if (
    lower === "data" ||
    lower.includes("/data") ||
    lower.includes("dataset") ||
    lower.includes("fixtures") ||
    lower.includes("seed")
  ) {
    return "data"
  }

  if (
    lower.includes("asset") ||
    lower.includes("media") ||
    lower.includes("public") ||
    lower.includes("static") ||
    lower.includes("css") ||
    lower.includes("image") ||
    lower.includes("layout")
  ) {
    return "assets"
  }

  if (
    lower.includes("config") ||
    lower.includes("settings") ||
    lower.includes("layout") ||
    lower.includes("schema")
  ) {
    return "config"
  }

  if (lower.includes("script") || lower.includes("bin") || lower.includes("tool")) {
    return "scripts"
  }

  if (lower.includes("component") || lower.includes("/ui")) {
    return "components"
  }

  if (lower.includes("route") || lower.includes("page")) {
    return "routes"
  }

  if (
    lower === "backend" ||
    lower.includes("/backend") ||
    lower === "server" ||
    lower.includes("/server") ||
    lower === "api" ||
    lower.includes("/api")
  ) {
    return "backend"
  }

  if (
    lower === "frontend" ||
    lower.includes("/frontend") ||
    lower === "client" ||
    lower.includes("/client") ||
    lower === "web" ||
    lower.includes("/web")
  ) {
    return "frontend"
  }

  if (
    lower === "src" ||
    lower.includes("/src") ||
    lower === "app" ||
    lower.includes("/app") ||
    lower.includes("/js") ||
    lower.includes("/lib") ||
    lower.includes("/core")
  ) {
    return "source"
  }

  return "unknown"
}

function countFiles(node: WorkspaceNode): number {
  if (node.type === "file") return 1
  return node.children?.reduce((total, child) => total + countFiles(child), 0) ?? 0
}

export function scanWorkspaceTree(root: WorkspaceNode | null): WorkspaceScanReport | null {
  if (!root) return null

  const report: WorkspaceScanReport = {
    rootName: root.name,
    fileCount: 0,
    folderCount: 0,
    languages: {},
    keyFiles: {
      envExamples: [],
    },
    folders: [],
    likelyEntryPoints: [],
    existingGuidance: {
      contextFiles: [],
    },
    ignoredHints: [],
  }

  function visit(node: WorkspaceNode) {
    const relPath = node.relPath || node.name
    const name = node.name.toLowerCase()

    if (node.type === "folder") {
      report.folderCount += 1

      if (node.relPath) {
        report.folders.push({
          path: node.relPath,
          fileCount: countFiles(node),
          likelyRole: roleFromPath(node.relPath),
        })
      }

      node.children?.forEach(visit)
      return
    }

    report.fileCount += 1

    const ext = getExt(relPath)
    if (ext) {
      report.languages[ext] = (report.languages[ext] || 0) + 1
    }

    if (name === "package.json") report.keyFiles.packageJson = relPath
    if (name === "tsconfig.json") report.keyFiles.tsconfig = relPath
    if (name.startsWith("vite.config.")) report.keyFiles.viteConfig = relPath
    if (name === "readme.md") report.keyFiles.readme = relPath
    if (name === ".gitignore") report.keyFiles.gitignore = relPath
    if (name === "go.mod") report.keyFiles.goMod = relPath
    if (name === "pyproject.toml") report.keyFiles.pyProject = relPath
    if (name === "cargo.toml") report.keyFiles.cargoToml = relPath
    if (name === "requirements.txt") report.keyFiles.requirementsTxt = relPath

    if (name.includes(".env.example") || name === "example.env") {
      report.keyFiles.envExamples.push(relPath)
    }

    if (name === "start_here.md") report.existingGuidance.startHere = relPath
    if (name === "agents.md") report.existingGuidance.agents = relPath
    if (name === "rules.md") report.existingGuidance.rules = relPath
    if (name === "context.md") report.existingGuidance.contextFiles.push(relPath)

    if (
        name === "server.py" ||
        name === "app.py" ||
        name === "main.py" ||
        name === "index.html" ||
        name === "main.ts" ||
        name === "main.tsx" ||
        name === "index.ts" ||
        name === "index.tsx" ||
        name === "app.ts" ||
        name === "app.tsx" ||
        name === "main.go"
        ) {
        report.likelyEntryPoints.push(relPath)
        }
  }

  visit(root)

  report.folders.sort((a, b) => b.fileCount - a.fileCount)
  report.likelyEntryPoints = report.likelyEntryPoints.slice(0, 12)

  return report
}