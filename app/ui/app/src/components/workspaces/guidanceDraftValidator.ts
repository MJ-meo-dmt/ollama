import type { GuidanceDraft, WorkspaceScanReport } from "./workspaceScanner"

export type GuidanceDraftValidation = {
  ok: boolean
  errors: string[]
  warnings: string[]
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").trim()
}

function includesAny(value: string, needles: string[]) {
  const lower = value.toLowerCase()
  return needles.some((needle) => lower.includes(needle.toLowerCase()))
}

export function validateGuidanceDraft(
  draft: GuidanceDraft | null,
  report: WorkspaceScanReport | null,
): GuidanceDraftValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (!draft) {
    return {
      ok: false,
      errors: ["No guidance draft was generated."],
      warnings,
    }
  }

  if (draft.type !== "guidance_draft") {
    errors.push("Draft type must be guidance_draft.")
  }

  if (!Array.isArray(draft.files) || draft.files.length === 0) {
    errors.push("Draft must include at least one file.")
  }

  const normalizedFiles = draft.files.map((file) => ({
    ...file,
    path: normalizePath(file.path),
  }))

  const paths = normalizedFiles.map((file) => file.path)
  const lowerPaths = paths.map((path) => path.toLowerCase())

  const requiredFiles = ["START_HERE.md", "rules.md", "AGENTS.md"]

  for (const required of requiredFiles) {
    if (!lowerPaths.includes(required.toLowerCase())) {
      errors.push(`Missing required guidance file: ${required}`)
    }
  }

  const seen = new Set<string>()

  for (const file of normalizedFiles) {
    const lowerPath = file.path.toLowerCase()

    if (!file.path) {
      errors.push("Draft contains a file with an empty path.")
      continue
    }

    if (file.path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(file.path)) {
      errors.push(`Guidance path must be relative: ${file.path}`)
    }

    if (file.path.includes("..")) {
      errors.push(`Guidance path cannot contain '..': ${file.path}`)
    }

    if (!lowerPath.endsWith(".md")) {
      errors.push(`Guidance file must be markdown: ${file.path}`)
    }

    if (seen.has(lowerPath)) {
      errors.push(`Duplicate guidance file path: ${file.path}`)
    }

    seen.add(lowerPath)

    if (!file.content || file.content.trim().length < 20) {
      errors.push(`Guidance file content is too short: ${file.path}`)
    }

    if (file.content.length > 8000) {
      warnings.push(`Guidance file is quite long and may waste context: ${file.path}`)
    }
  }

  if (report) {
    const existingFolders = new Set(
      report.folders.map((folder) => normalizePath(folder.path).toLowerCase()),
    )

    for (const file of normalizedFiles) {
      const lowerPath = file.path.toLowerCase()

      if (lowerPath.endsWith("/context.md")) {
        const folderPath = lowerPath.replace(/\/context\.md$/, "")

        if (!existingFolders.has(folderPath)) {
          errors.push(
            `Folder context file targets a folder not found in scan report: ${file.path}`,
          )
        }
      }
    }

    const startHere = normalizedFiles.find(
      (file) => file.path.toLowerCase() === "start_here.md",
    )

    if (startHere && report.likelyEntryPoints.length > 0) {
      for (const entryPoint of report.likelyEntryPoints.slice(0, 3)) {
        if (!startHere.content.includes(entryPoint)) {
          warnings.push(`START_HERE.md does not mention likely entry point: ${entryPoint}`)
        }
      }
    }

    const runtimeFolders = report.folders.filter(
      (folder) => folder.likelyRole === "runtime",
    )

    const allContent = normalizedFiles
      .map((file) => `${file.path}\n${file.content}`)
      .join("\n\n")
      .toLowerCase()

    for (const folder of runtimeFolders) {
      if (!allContent.includes(folder.path.toLowerCase())) {
        warnings.push(`Runtime folder is not mentioned in guidance: ${folder.path}`)
      }
    }

    const unknownFolders = report.folders.filter(
      (folder) => folder.likelyRole === "unknown",
    )

    for (const folder of unknownFolders) {
      const lowerFolder = folder.path.toLowerCase()

      if (
        allContent.includes(lowerFolder) &&
        includesAny(allContent, [
          `never modify ${lowerFolder}`,
          `do not modify ${lowerFolder}`,
          `runtime-generated ${lowerFolder}`,
        ])
      ) {
        warnings.push(
          `Unknown folder is treated as hard runtime/generated. Prefer "ask before editing": ${folder.path}`,
        )
      }
    }
  }

  const allContent = normalizedFiles
    .map((file) => `${file.path}\n${file.content}`)
    .join("\n\n")
    .toLowerCase()

  if (
    allContent.includes("can read and write files in") &&
    allContent.includes("never modify data")
  ) {
    warnings.push(
      "Possible contradiction: guidance says the agent can write broadly but also says never modify data.",
    )
  }

  if (
    allContent.includes("all guidance files are located in the root") &&
    lowerPaths.some((path) => path.endsWith("/context.md"))
  ) {
    warnings.push(
      "Possible contradiction: guidance says all guidance files are root-level, but folder context files exist.",
    )
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  }
}