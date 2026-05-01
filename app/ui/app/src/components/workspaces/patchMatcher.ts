export type PatchAnchors = {
  before?: string
  after?: string
}

export type PatchMatchMethod =
  | "exact"
  | "normalized"
  | "loose"
  | "anchor"
  | "failed"

export type PatchMatchResult = {
  ok: boolean
  content?: string
  method: PatchMatchMethod
  confidence: number
  startLine?: number
  endLine?: number
  reason?: string
}

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n")
}

function normalizeLoose(value: string) {
  return normalizeLineEndings(value)
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()
}

function normalizeComparableLine(value: string) {
  return value.trim()
}

function normalizeWithoutBlankLines(value: string) {
  return normalizeLineEndings(value)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .join("\n")
    .trim()
}

function preserveLineEndings(original: string, updated: string) {
  return original.includes("\r\n") ? updated.replace(/\n/g, "\r\n") : updated
}

function countLines(value: string) {
  if (!value) return 0
  return normalizeLineEndings(value).split("\n").length
}

function findLooseMatchRange(content: string, snippet: string) {
  const contentLines = normalizeLineEndings(content).split("\n")
  const snippetLines = normalizeLineEndings(snippet).split("\n")
  const normalizedSnippet = normalizeLoose(snippet)

  const maxWindow = Math.max(4, snippetLines.length + 6)

  for (let start = 0; start < contentLines.length; start++) {
    for (
      let end = start + 1;
      end <= Math.min(contentLines.length, start + maxWindow);
      end++
    ) {
      const candidate = contentLines.slice(start, end).join("\n")

      if (normalizeLoose(candidate) === normalizedSnippet) {
        const confidence =
          snippetLines.length > 0
            ? Math.min(1, snippetLines.length / Math.max(1, end - start))
            : 0

        return {
          start,
          end,
          confidence,
        }
      }
    }
  }

  return null
}

function findOrderedLineMatchRange(content: string, snippet: string) {
  const contentLines = normalizeLineEndings(content).split("\n")
  const snippetLines = normalizeLineEndings(snippet)
    .split("\n")
    .map(normalizeComparableLine)
    .filter(Boolean)

  if (snippetLines.length === 0) return null

  for (let start = 0; start < contentLines.length; start++) {
    let snippetIndex = 0
    let end = start

    for (; end < contentLines.length; end++) {
      const currentLine = normalizeComparableLine(contentLines[end])

      if (!currentLine) continue

      if (currentLine === snippetLines[snippetIndex]) {
        snippetIndex += 1
      }

      if (snippetIndex === snippetLines.length) {
        const matchedLength = end - start + 1
        const confidence = Math.min(
          0.9,
          snippetLines.length / Math.max(snippetLines.length, matchedLength),
        )

        return {
          start,
          end: end + 1,
          confidence,
        }
      }
    }
  }

  return null
}

function findBlankLineInsensitiveMatchRange(content: string, snippet: string) {
  const contentLines = normalizeLineEndings(content).split("\n")
  const snippetLines = normalizeLineEndings(snippet).split("\n")
  const normalizedSnippet = normalizeWithoutBlankLines(snippet)

  const maxWindow = Math.max(4, snippetLines.length + 8)

  for (let start = 0; start < contentLines.length; start++) {
    for (
      let end = start + 1;
      end <= Math.min(contentLines.length, start + maxWindow);
      end++
    ) {
      const candidate = contentLines.slice(start, end).join("\n")

      if (normalizeWithoutBlankLines(candidate) === normalizedSnippet) {
        return {
          start,
          end,
          confidence: 0.85,
        }
      }
    }
  }

  return null
}

function findAnchorRange(
  currentContent: string,
  anchors?: PatchAnchors,
): {
  start: number
  end: number
  confidence: number
} | null {
  if (!anchors?.before && !anchors?.after) return null

  const lines = normalizeLineEndings(currentContent).split("\n")

  const before = anchors.before ? normalizeLoose(anchors.before) : null
  const after = anchors.after ? normalizeLoose(anchors.after) : null

  let beforeEnd = 0
  let afterStart = lines.length
  let matchedAnchors = 0

  if (before) {
    const beforeLines = countLines(before)
    const beforeWindow = Math.max(12, beforeLines + 6)
    let found = false

    for (let start = 0; start < lines.length; start++) {
      for (
        let end = start + 1;
        end <= Math.min(lines.length, start + beforeWindow);
        end++
      ) {
        const candidate = lines.slice(start, end).join("\n")

        if (normalizeLoose(candidate) === before) {
          beforeEnd = end
          matchedAnchors += 1
          found = true
          break
        }
      }

      if (found) break
    }

    if (!found) return null
  }

  if (after) {
    const afterLines = countLines(after)
    const afterWindow = Math.max(12, afterLines + 6)
    let found = false

    for (let start = beforeEnd; start < lines.length; start++) {
      for (
        let end = start + 1;
        end <= Math.min(lines.length, start + afterWindow);
        end++
      ) {
        const candidate = lines.slice(start, end).join("\n")

        if (normalizeLoose(candidate) === after) {
          afterStart = start
          matchedAnchors += 1
          found = true
          break
        }
      }

      if (found) break
    }

    if (!found) return null
  }

  if (beforeEnd > afterStart) return null

  const expectedAnchors = Number(Boolean(before)) + Number(Boolean(after))
  const confidence =
    expectedAnchors > 0 ? matchedAnchors / expectedAnchors : 0

  return {
    start: beforeEnd,
    end: afterStart,
    confidence,
  }
}

export function applyPatchMatch(params: {
  currentContent: string
  originalSnippet: string
  replacementSnippet: string
  anchors?: PatchAnchors
  minConfidence?: number
}): PatchMatchResult {
  const {
    currentContent,
    originalSnippet,
    replacementSnippet,
    anchors,
    minConfidence = 0.65,
  } = params

  if (!originalSnippet && !anchors?.before && !anchors?.after) {
    return {
      ok: false,
      method: "failed",
      confidence: 0,
      reason: "No original snippet or anchors provided.",
    }
  }

  // 1. Exact match
  if (originalSnippet && currentContent.includes(originalSnippet)) {
    const before = currentContent.slice(0, currentContent.indexOf(originalSnippet))
    const startLine = countLines(before)

    return {
      ok: true,
      content: currentContent.replace(originalSnippet, replacementSnippet),
      method: "exact",
      confidence: 1,
      startLine,
      endLine: startLine + countLines(originalSnippet) - 1,
    }
  }

  const normalizedCurrent = normalizeLineEndings(currentContent)
  const normalizedOriginal = normalizeLineEndings(originalSnippet)
  const normalizedReplacement = normalizeLineEndings(replacementSnippet)

  // 2. Normalized line-ending match
  if (originalSnippet && normalizedCurrent.includes(normalizedOriginal)) {
    const before = normalizedCurrent.slice(
      0,
      normalizedCurrent.indexOf(normalizedOriginal),
    )
    const startLine = countLines(before)

    const updated = normalizedCurrent.replace(
      normalizedOriginal,
      normalizedReplacement,
    )

    return {
      ok: true,
      content: preserveLineEndings(currentContent, updated),
      method: "normalized",
      confidence: 0.95,
      startLine,
      endLine: startLine + countLines(normalizedOriginal) - 1,
    }
  }

  // 3. Loose whitespace match
  if (originalSnippet) {
    const range = findLooseMatchRange(currentContent, originalSnippet)

    if (range && range.confidence >= minConfidence) {
      const lines = normalizeLineEndings(currentContent).split("\n")

      const updatedLines = [
        ...lines.slice(0, range.start),
        normalizedReplacement,
        ...lines.slice(range.end),
      ]

      return {
        ok: true,
        content: preserveLineEndings(currentContent, updatedLines.join("\n")),
        method: "loose",
        confidence: range.confidence,
        startLine: range.start + 1,
        endLine: range.end,
      }
    }
  }

  const blankLineRange = findBlankLineInsensitiveMatchRange(
    currentContent,
    originalSnippet,
    )

  if (originalSnippet && blankLineRange && blankLineRange.confidence >= minConfidence) {
    const lines = normalizeLineEndings(currentContent).split("\n")

    const updatedLines = [
        ...lines.slice(0, blankLineRange.start),
        normalizedReplacement,
        ...lines.slice(blankLineRange.end),
    ]

    return {
        ok: true,
        content: preserveLineEndings(currentContent, updatedLines.join("\n")),
        method: "loose",
        confidence: blankLineRange.confidence,
        startLine: blankLineRange.start + 1,
        endLine: blankLineRange.end,
    }
    }

  const orderedLineRange = findOrderedLineMatchRange(
    currentContent,
    originalSnippet,
    )

    if (
    originalSnippet &&
    orderedLineRange &&
    orderedLineRange.confidence >= minConfidence
    ) {
    const lines = normalizeLineEndings(currentContent).split("\n")

    const updatedLines = [
        ...lines.slice(0, orderedLineRange.start),
        normalizedReplacement,
        ...lines.slice(orderedLineRange.end),
    ]

    return {
        ok: true,
        content: preserveLineEndings(currentContent, updatedLines.join("\n")),
        method: "loose",
        confidence: orderedLineRange.confidence,
        startLine: orderedLineRange.start + 1,
        endLine: orderedLineRange.end,
    }
    }

  // 4. Anchor fallback
  if (originalSnippet) {
    return {
        ok: false,
        method: "failed",
        confidence: 0,
        reason:
        "Original snippet did not match current file. Anchor fallback was skipped to avoid unsafe replacement.",
    }
    }

  const anchorRange = findAnchorRange(currentContent, anchors)

  if (anchorRange && anchorRange.confidence >= minConfidence) {
    const lines = normalizeLineEndings(currentContent).split("\n")

    const updatedLines = [
      ...lines.slice(0, anchorRange.start),
      normalizedReplacement,
      ...lines.slice(anchorRange.end),
    ]

    return {
      ok: true,
      content: preserveLineEndings(currentContent, updatedLines.join("\n")),
      method: "anchor",
      confidence: anchorRange.confidence,
      startLine: anchorRange.start + 1,
      endLine: anchorRange.end,
    }
  }

  return {
    ok: false,
    method: "failed",
    confidence: 0,
    reason:
      "No safe patch match found. Exact, normalized, loose, and anchor matching all failed.",
  }
}