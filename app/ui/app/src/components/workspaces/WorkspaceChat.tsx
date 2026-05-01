// src/components/workspaces/WorkspaceChat.tsx

import { useEffect, useRef, useState } from "react"
import StreamingMarkdownContent from "@/components/StreamingMarkdownContent"
import { useQuery } from "@tanstack/react-query"
import { getSettings, getInferenceCompute } from "@/api"
import ollama from "ollama/browser"
import type { WorkspaceNode } from "@/types/workspace-webview"
import type { WorkspacePatchProposal } from "./patchTypes"
import { ModelPicker } from "@/components/ModelPicker"
import { useSelectedModel } from "@/hooks/useSelectedModel"
import { ContextManager } from "./contextManager"

const MAX_CONTEXT_AUTO_ROUNDS = 2
const CHAT_STORAGE_KEY = "workspace_chat_messages"

const WORKSPACE_COMMANDS = [
  { name: "@ask", description: "Ask or explain" },
  { name: "@context", description: "Show loaded context" },
  { name: "@plan", description: "Plan changes" },
  { name: "@patch", description: "Propose editable patch" },
]

const PATCH_BUSY_MESSAGES = [
  "Preparing patch proposal",
  "Checking loaded context",
  "Drafting safe changes",
  "Validating patch shape",
]

type ContextRequest = {
  type: "context_request" | "read_file"
  reason?: string
  files?: string[]
  path?: string
}

type WorkspaceChatProps = {
  workspacePath: string | null
  workspaceMap: string
  selectedFile: string | null
  selectedFileContent: string
  guidanceFiles: WorkspaceNode[]
  onPatchProposal?: (proposal: WorkspacePatchProposal) => void
}

type WorkspaceCommand = "ask" | "plan" | "patch" | "context"

type ChatMessage = {
  role: "user" | "assistant"
  content: string
}

function resolveWorkspacePath(
  requestedPath: string,
  workspacePath: string | null,
) {
  if (!workspacePath) return requestedPath

  const looksAbsolute =
    /^[a-zA-Z]:[\\/]/.test(requestedPath) || requestedPath.startsWith("/")

  if (looksAbsolute) {
    return requestedPath
  }

  return `${workspacePath.replace(/[\\/]+$/, "")}/${requestedPath.replace(/^[/\\]+/, "")}`
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

function getRequestedFiles(request: ContextRequest) {
  if (request.type === "read_file" && request.path) {
    return [request.path]
  }

  return request.files || []
}

function isContextRequest(value: unknown): value is ContextRequest {
  if (typeof value !== "object" || value === null) return false

  const item = value as ContextRequest

  return (
    (item.type === "context_request" && Array.isArray(item.files)) ||
    (item.type === "read_file" && typeof item.path === "string")
  )
}

function isValidPatchProposal(value: unknown): value is WorkspacePatchProposal {
  if (typeof value !== "object" || value === null) return false

  const proposal = value as WorkspacePatchProposal

  if (proposal.type !== "patch_proposal") return false
  if (!Array.isArray(proposal.files)) return false

  return proposal.files.every((file) => {
    return (
      typeof file.path === "string" &&
      ["edit", "create", "delete"].includes(file.action) &&
      typeof file.original_snippet === "string" &&
      typeof file.replacement_snippet === "string" &&
      typeof file.reason === "string"
    )
  })
}

function parseWorkspaceCommand(input: string): {
  command: WorkspaceCommand
  task: string
} {
  const trimmed = input.trim()
  //const match = trimmed.match(/^@(\w+)\s+(.*)$/s)
  const match = trimmed.match(/^@(\w+)(?:\s+(.*))?$/s)

  if (!match) {
    return { command: "ask", task: trimmed }
  }

  const rawCommand = match[1].toLowerCase()
  const task = (match[2] || "").trim()

  if (rawCommand === "plan") {
    return { command: "plan", task }
  }

  if (rawCommand === "patch") {
    return { command: "patch", task }
  }

  if (rawCommand === "context") {
    return { command: "context", task }
  }

  return { command: "ask", task: trimmed }
}

function isCreateTask(task: string) {
  return /\b(create|new file|add file|make file)\b/i.test(task)
}

function getBaseName(path: string) {
  return path.replace(/\\/g, "/").split("/").pop() || path
}

function taskMentionsAnotherFile(task: string, selectedFile: string | null) {
  if (!selectedFile) return false

  const selectedBaseName = getBaseName(selectedFile).toLowerCase()
  const taskLower = task.toLowerCase()

  const mentionedFiles: string[] =
    taskLower.match(/[\w.-]+\.(ts|tsx|js|jsx|md|json|css|html|go|py|rs)/g) ?? []

  if (mentionedFiles.length === 0) return false

  return !mentionedFiles.some((file) => file === selectedBaseName)
}

function getMentionedFileNames(task: string) {
  return (
    task
      .toLowerCase()
      .match(/(?:\/?[\w.-]+)*\/?[\w.-]+\.(ts|tsx|js|jsx|md|json|css|html|go|py|rs)/g) ?? []
  ).map((file) => file.replace(/^\/+/, ""))
}

function findBareFileMentionInWorkspaceMap(
  task: string,
  workspaceMap: string,
  workspacePath: string | null,
) {
  if (!workspacePath) return null

  const taskLower = task.toLowerCase()
  const stack: string[] = []

  for (const line of workspaceMap.split(/\r?\n/)) {
    if (!line.trim() || line.includes("[workspace map trimmed]")) continue

    const depth = Math.floor((line.match(/^ */)?.[0].length || 0) / 2)
    const cleanName = line.trim().replace(/\/$/, "")
    const lowerName = cleanName.toLowerCase()

    stack[depth] = cleanName
    stack.length = depth + 1

    if (!lowerName.includes(".")) continue

    const baseName = lowerName.split(".")[0]

    if (taskLower.includes(baseName)) {
      const relPath = stack.slice(1).join("/")

      if (!relPath) return null

      return `${workspacePath.replace(/[\\/]+$/, "")}/${relPath}`
    }
  }

  return null
}

function findMentionedFileInWorkspaceMap(
  fileName: string,
  workspaceMap: string,
  workspacePath: string | null,
) {
  if (!workspacePath) return null

  const target = fileName.toLowerCase().replace(/^\/+/, "")
  const stack: string[] = []

  for (const line of workspaceMap.split(/\r?\n/)) {
    if (!line.trim() || line.includes("[workspace map trimmed]")) continue

    const depth = Math.floor((line.match(/^ */)?.[0].length || 0) / 2)
    const cleanName = line.trim().replace(/\/$/, "")

    stack[depth] = cleanName
    stack.length = depth + 1

    const relPath = stack.slice(1).join("/").toLowerCase()

    if (
      relPath === target ||
      cleanName.toLowerCase() === target ||
      relPath.endsWith(`/${target}`)
    ) {
      return `${workspacePath.replace(/[\\/]+$/, "")}/${stack.slice(1).join("/")}`
    }
  }

  return null
}

export function WorkspaceChat({
  workspacePath,
  workspaceMap,
  selectedFile,
  selectedFileContent,
  guidanceFiles,
  onPatchProposal,
}: WorkspaceChatProps) {
  const [message, setMessage] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || "[]")
    } catch {
      return []
    }
  })

  const contextManagerRef = useRef(new ContextManager())

  const [contextStats, setContextStats] = useState({
    modelContextLength: 32768,
    reservedForResponse: 3000,
    availableForContext: 29768,
    usedTokens: 0,
    remainingTokens: 29768,
    percentUsed: 0,
  })

  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const { selectedModel } = useSelectedModel()
  const { data: settingsData } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  })

  const { data: inferenceComputeResponse } = useQuery({
    queryKey: ["inferenceCompute"],
    queryFn: getInferenceCompute,
  })

  const modelContextLength =
    settingsData?.settings?.ContextLength ||
    inferenceComputeResponse?.defaultContextLength ||
    32768

  const [commandMenuOpen, setCommandMenuOpen] = useState(false)
  const [commandIndex, setCommandIndex] = useState(0)
  const commandQuery = message.startsWith("@")
    ? message.slice(1).toLowerCase()
    : ""

  const filteredCommands =
    commandQuery.length > 0
      ? WORKSPACE_COMMANDS.filter((command) =>
          command.name.slice(1).startsWith(commandQuery),
        )
      : WORKSPACE_COMMANDS

  const [patchBusyIndex, setPatchBusyIndex] = useState(0)

  const selectCommand = (command: string) => {
    setMessage(`${command} `)
    setCommandMenuOpen(false)
    textareaRef.current?.focus()
  }

  useEffect(() => {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages))
  }, [messages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isRunning, error])

  useEffect(() => {
    if (!isRunning) {
      textareaRef.current?.focus()
    }
  }, [isRunning])

  useEffect(() => {
    if (!isRunning) {
      setPatchBusyIndex(0)
      return
    }

    const interval = window.setInterval(() => {
      setPatchBusyIndex((prev) => (prev + 1) % PATCH_BUSY_MESSAGES.length)
    }, 1200)

    return () => window.clearInterval(interval)
  }, [isRunning])

  const handleSend = async () => {
    const userMessage = message.trim()

    if (!userMessage || isRunning) {
      return
    }

    const parsed = parseWorkspaceCommand(userMessage)
    const contextManager = contextManagerRef.current

    if (parsed.command === "context") {
      const stats = contextManager.getStats(modelContextLength)
      const loadedFiles = contextManager.getLoadedFiles()

      setMessage("")

      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: userMessage,
        },
        {
          role: "assistant",
          content: `## Loaded Context

    **Workspace:** ${workspacePath || "none"}

    **Model context length:** ${stats.modelContextLength.toLocaleString()} tokens

    **Approx context used:** ${stats.usedTokens.toLocaleString()} / ${stats.availableForContext.toLocaleString()} tokens

    **Remaining:** ${stats.remainingTokens.toLocaleString()} tokens

    **Loaded files:**

    ${
      loadedFiles.length
        ? loadedFiles
            .map(
              (file) =>
                `- ${file.relPath || file.path} — ${file.mode}, ~${file.tokensEstimate} tokens, priority ${file.priority}`,
            )
            .join("\n")
        : "- none"
    }

    **Workspace map:** ${workspaceMap ? "loaded" : "not loaded"}`,
        },
      ])

      return
    }

    contextManager.resetTurn()
    contextManager.clearTaskContext()

    const mentionedFiles = getMentionedFileNames(parsed.task)
    const shouldPreloadMentionedFiles = !isCreateTask(parsed.task)

    let focusedFileFromTask: string | null = null

    if (shouldPreloadMentionedFiles) {
      for (const fileName of mentionedFiles) {
      const resolved = findMentionedFileInWorkspaceMap(
        fileName,
        workspaceMap,
        workspacePath,
      )

      if (!resolved) {
        continue
      }

      focusedFileFromTask = resolved

      try {
        await contextManager.loadFile({
          path: resolved,
          workspacePath,
          source: "requested",
          task: parsed.task,
          priority: 98,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to load ${resolved}`)
      }
    }
  }

    if (!focusedFileFromTask && shouldPreloadMentionedFiles) {
      const resolvedBareMention = findBareFileMentionInWorkspaceMap(
        parsed.task,
        workspaceMap,
        workspacePath,
      )

      if (resolvedBareMention) {
        focusedFileFromTask = resolvedBareMention

        try {
          await contextManager.loadFile({
            path: resolvedBareMention,
            workspacePath,
            source: "requested",
            task: parsed.task,
            priority: 98,
          })
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : `Failed to load ${resolvedBareMention}`,
          )
        }
      }
    }

    if (
      selectedFile &&
      !focusedFileFromTask &&
      !taskMentionsAnotherFile(parsed.task, selectedFile)
    ) {
      contextManager.registerSelectedFile({
        path: selectedFile,
        content: selectedFileContent,
        workspacePath,
        task: parsed.task,
      })
    }

    await contextManager.loadGuidanceFiles({
      files: guidanceFiles,
      workspacePath,
      task: parsed.task,
      selectedFile: focusedFileFromTask || selectedFile,
    })

    setContextStats(contextManager.getStats(modelContextLength))

    setIsRunning(true)
    setError(null)
    setMessage("")

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: userMessage,
      },
    ])

    try {
      const chatHistory = messages
        .filter((item) => {
          const text = item.content.toLowerCase()

          return (
            !text.includes("failed to load") &&
            !text.includes("failed to read") &&
            !text.includes("file unreadable") &&
            !text.includes("missing at")
          )
        })
        .slice(-6)
        .map((item) => `${item.role.toUpperCase()}:\n${item.content}`)
        .join("\n\n")

      const contextRequestRules = `CONTEXT REQUEST RULES:
  - If you need more files before answering safely, return ONLY this JSON:
  - Do not invent tools such as read_file.
  - The app only supports context_request JSON.
  - If you need to read files, return ONLY:
  {
    "type": "context_request",
    "reason": "why these files are needed",
    "files": ["relative/or/full/path"]
  }
  - Ask for the fewest files needed.
  - Prefer files mentioned by guidance files or the workspace map.
  - Use full paths if they are already shown in the workspace context.`
      const isCreatePatchTask =
        parsed.command === "patch" && isCreateTask(parsed.task)
      const commandRules =
        parsed.command === "patch"
          ? `PATCH MODE RULES:
  - For create actions, do not request or read the target file first.
  - If the task is to create a new file, return a create patch immediately.
  - Paths must be relative to workspace root (no leading /)
  - Return ONLY valid JSON.
  - Do not include markdown fences.
  - Do not explain outside the JSON.
  - Prefer exact original_snippet matching when possible.
  - If exact matching may be fragile, include anchors.before and anchors.after.
  - anchors.before should be stable text immediately before the replacement area.
  - anchors.after should be stable text immediately after the replacement area.
  - Do not use anchors unless they are copied from loaded context.
  ${isCreatePatchTask ? "" : contextRequestRules}
  - Never output read or context_request actions in create tasks.
  - For create tasks, you already have enough information.
  - If required context is missing, request context first.
  - After context is loaded, you MUST return a patch_proposal JSON object.
  - For create actions, use original_snippet as an empty string.
  - For edit actions, original_snippet must be copied exactly from loaded context.
  - Never answer with prose in patch mode.
  - Use this shape when enough context is loaded:
  {
    "type": "patch_proposal",
    "summary": "short summary",
    "files": [
      {
        "path": "relative/or/full/path",
        "action": "edit|create|delete",
        "original_snippet": "exact old text for edits, empty for create",
        "replacement_snippet": "new text",
        "anchors": {
          "before": "optional stable text before edit",
          "after": "optional stable text after edit"
        },
        "reason": "why this change is needed"
      }
    ],
    "notes": ["optional notes"]
  }
  - Prefer editing the selected file unless the task clearly needs another file.
  - Do not claim files were changed.`
          : parsed.command === "plan"
            ? `PLAN MODE RULES:
  - Return a clear step-by-step plan.
  - Do not write files.
  - Do not claim changes were made.
  - Mention which files should be inspected or changed.
  ${contextRequestRules}`
          : `ASK MODE RULES:
  - Never invent file contents. If the requested file is not in LOADED CONTEXT, request context instead of answering.
  - If the requested file is already loaded, answer directly from it without mentioning internal context mechanics.
  - If the requested file is not loaded, request it as context first.
  - Explain clearly.
  - Use workspace guidance first.
  - If a requested file failed to load, say that clearly and do not explain it from guesses.
  - Do not claim files were edited.
  - If code changes are needed, suggest them but do not apply them.
  ${contextRequestRules}`

      const buildPrompt = () => `You are the Ollama Workspace Agent.

        You are working inside a local workspace.

        WORKSPACE ROOT:
        ${workspacePath || "No workspace selected"}

        WORKSPACE MAP:
        ${workspaceMap || "No workspace map available."}

        RECENT CHAT HISTORY:
        ${chatHistory || "No previous chat history."}

        CONTEXT PRIORITY:
        1. LOADED CONTEXT is authoritative.
        2. RECENT CHAT HISTORY is only conversation memory.
        3. If they conflict, trust LOADED CONTEXT.
        4. Do not repeat old file-load failures if the file is currently loaded.
        LOADED CONTEXT:
        ${contextManager.buildPromptContext(modelContextLength)}

        CONTEXT BUDGET:
        ${JSON.stringify(contextManager.getStats(modelContextLength), null, 2)}

        COMMAND:
        @${parsed.command}

        USER TASK:
        ${parsed.task}

        RULES:
        ${commandRules}
        `

      let fullResponse = ""

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            parsed.command === "patch"
              ? "__PATCH_BUSY__"
              : "",
        },
      ])

      for (let round = 0; round <= MAX_CONTEXT_AUTO_ROUNDS; round++) {
        fullResponse = ""

        const stream = await ollama.generate({
          model: selectedModel?.model || "qwen3.5:9b",
          prompt: buildPrompt(),
          stream: true,
          think: thinkingEnabled,
        })

        for await (const part of stream) {
          const chunk = part.response || ""
          fullResponse += chunk

          if (parsed.command !== "patch") {
            setMessages((prev) => {
              const next = [...prev]
              const lastIndex = next.length - 1

              if (lastIndex >= 0 && next[lastIndex].role === "assistant") {
                next[lastIndex] = {
                  ...next[lastIndex],
                  content: fullResponse,
                }
              }

              return next
            })
          }
        }

        const possibleJson = extractJsonObject(fullResponse)

        if (!isContextRequest(possibleJson)) {
          break
        }

        const requestedFiles = getRequestedFiles(possibleJson)
          .map((path) => resolveWorkspacePath(path, workspacePath))
          .filter((path) => {
            if (contextManager.hasFile(path)) return false
            if (contextManager.wasRequestedThisTurn(path)) return false
            return true
          })

        if (requestedFiles.length === 0) {
          fullResponse = ""

          const continueStream = await ollama.generate({
            model: selectedModel?.model || "qwen3.5:9b",
            prompt: `${buildPrompt()}

          IMPORTANT:
          The requested context is already loaded or was already requested this turn.
          Do not request the same file again.
          Continue the user's task now.`,
            stream: true,
            think: thinkingEnabled,
          })

          for await (const part of continueStream) {
            const chunk = part.response || ""
            fullResponse += chunk

            setMessages((prev) => {
              const next = [...prev]
              const lastIndex = next.length - 1

              if (lastIndex >= 0 && next[lastIndex].role === "assistant") {
                next[lastIndex] = {
                  ...next[lastIndex],
                  content: fullResponse,
                }
              }
              return next
            })
          }

          break
        }

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Loading requested context:\n\n${requestedFiles
              .map((file) => `- ${file}`)
              .join("\n")}`,
          },
        ])

        for (const path of requestedFiles) {
          contextManager.markRequested(path)

          try {
          await contextManager.loadFile({
            path,
            workspacePath,
            source: "requested",
            task: parsed.task,
            priority: 80,
          })
        } catch (err) {
          setError(err instanceof Error ? err.message : `Failed to load ${path}`)
        }
      }

        setContextStats(contextManager.getStats(modelContextLength))

        if (round === MAX_CONTEXT_AUTO_ROUNDS) {
            fullResponse = ""

            const finalPatchStream = await ollama.generate({
              model: selectedModel?.model || "qwen3.5:9b",
              prompt: `${buildPrompt()}

          IMPORTANT:
          You have reached the maximum automatic context loading rounds.
          Do not request more context.
          Return the final answer now.

          If this is PATCH mode, return ONLY a valid patch_proposal JSON object.`,
              stream: true,
              think: thinkingEnabled,
            })

            for await (const part of finalPatchStream) {
              fullResponse += part.response || ""
            }

            break
          }
      }

      if (parsed.command === "patch") {
        try {
          const proposal = extractJsonObject(fullResponse) as WorkspacePatchProposal | null

          if (isValidPatchProposal(proposal)) {
            onPatchProposal?.(proposal)

            setMessages((prev) => {
              const next = [...prev]
              const lastIndex = next.length - 1

              if (lastIndex >= 0 && next[lastIndex].role === "assistant") {
                next[lastIndex] = {
                  ...next[lastIndex],
                  content:
                    "Patch proposal generated. Review it in the patch panel.",
                }
              }

              return next
            })
          }
           else {
            setError(
              `Invalid patch proposal. Expected only edit/create/delete actions. First 500 chars:\n${fullResponse.slice(0, 500)}`,
            )

            setMessages((prev) => {
              const next = [...prev]
              const lastIndex = next.length - 1

              if (lastIndex >= 0 && next[lastIndex].role === "assistant") {
                next[lastIndex] = {
                  ...next[lastIndex],
                  content: "Patch proposal failed validation. See error details below.",
                }
              }

              return next
            })
          }
        } catch {
          setError(
            `Patch response was not valid JSON. First 500 chars:\n${fullResponse.slice(0, 500)}`,
          )
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Workspace chat failed")
    } finally {
      setIsRunning(false)
    }
  }
    
  return (
    <section className="flex h-full flex-col overflow-hidden border-l border-neutral-300 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start justify-between border-b border-neutral-300 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div>
          <h2 className="font-medium dark:text-white">Workspace Chat</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Uses selected file + guidance files as context.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            localStorage.removeItem(CHAT_STORAGE_KEY)
            setMessages([])
            setError(null)
          }}
          className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Clear chat
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 text-sm">
        <div className="rounded-xl bg-neutral-200/60 p-3 text-xs dark:bg-neutral-800 dark:text-neutral-300">
          <div>
            <span className="font-medium">Workspace:</span>{" "}
            <span className="font-mono">{workspacePath || "none"}</span>
          </div>
          <div className="mt-1">
            <span className="font-medium">Selected:</span>{" "}
            <span className="font-mono">{selectedFile || "none"}</span>
          </div>
          <div className="mt-1">
            <span className="font-medium">Guidance:</span>{" "}
            {guidanceFiles.length || 0} files
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {messages.map((item, index) => (
            <div
              key={index}
              className={`rounded-xl p-3 ${
                item.role === "user"
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "bg-neutral-50 text-neutral-800 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
              }`}
            >
              <div className="mb-1 text-xs font-medium opacity-70">
                {item.role === "user" ? "You" : "Workspace Agent"}
              </div>
              {item.role === "assistant" ? (
                item.content === "__PATCH_BUSY__" ? (
                  <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                    <span>{PATCH_BUSY_MESSAGES[patchBusyIndex]}</span>
                    <span className="inline-flex gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
                    </span>
                  </div>
                ) : (
                  <StreamingMarkdownContent
                    content={item.content}
                    isStreaming={isRunning && index === messages.length - 1}
                    size="sm"
                  />
                )
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-sm">
                    {item.content}
                </pre>
                )}
            </div>
          ))}

          {isRunning && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="rounded-xl bg-neutral-50 p-3 text-sm text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300">
                {thinkingEnabled ? "Thinking..." : "Working..."}
            </div>
            )}

          {error && (
            <div className="rounded-xl bg-red-50 p-3 text-red-600 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t border-neutral-300 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-600 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300">
        <div className="flex items-center justify-between">
          <span className="font-medium">Context</span>
          <span>{contextStats.percentUsed}% used</span>
        </div>

        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className="h-full rounded-full bg-neutral-700 dark:bg-neutral-300"
            style={{ width: `${contextStats.percentUsed}%` }}
          />
        </div>

        <div className="mt-1 flex justify-between font-mono">
          <span>
            ~{contextStats.usedTokens.toLocaleString()} /{" "}
            {contextStats.availableForContext.toLocaleString()} ctx tokens
          </span>
          <span>
            ctx setting: {contextStats.modelContextLength.toLocaleString()}
          </span>
        </div>
      </div>
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(event) => {
            const value = event.target.value
            setMessage(value)

            const shouldShowCommands = value.startsWith("@") && !value.includes(" ")
            setCommandMenuOpen(shouldShowCommands)
            setCommandIndex(0)
          }}
          onKeyDown={(event) => {
            if (commandMenuOpen) {
              if (event.key === "ArrowDown") {
                event.preventDefault()
                setCommandIndex((prev) => (prev + 1) % filteredCommands.length)
                return
              }

              if (event.key === "ArrowUp") {
                event.preventDefault()
                setCommandIndex((prev) =>
                  prev === 0 ? filteredCommands.length - 1 : prev - 1,
                )
                return
              }

              if (event.key === "Tab" || event.key === "Enter") {
                event.preventDefault()
                const selectedCommand = filteredCommands[commandIndex]

                if (selectedCommand) {
                  selectCommand(selectedCommand.name)
                }
                return
              }

              if (event.key === "Escape") {
                setCommandMenuOpen(false)
                return
              }
            }

            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              handleSend()
            }
          }}
          placeholder="@ask explain this file, @context show loaded context, @plan change X, @patch edit selected file..."
          className="h-24 w-full resize-none rounded-lg border border-neutral-200 bg-white p-3 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white"
        />
        {commandMenuOpen && (
          <div className="mt-2 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 text-sm shadow-xl">
            {filteredCommands.map((command, index) => (
              <button
                key={command.name}
                onClick={() => selectCommand(command.name)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left ${
                  index === commandIndex
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                <span className="font-mono">{command.name}</span>
                <span className="text-xs text-neutral-400">{command.description}</span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-2 flex items-center gap-2">
          
            <button
                onClick={handleSend}
                disabled={isRunning || !message.trim()}
                className="flex-1 rounded-lg bg-black px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
            >
                {isRunning
                ? thinkingEnabled
                    ? "Thinking..."
                    : "Working..."
                : "Send"}
            </button>

            <label className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
                <input
                type="checkbox"
                checked={thinkingEnabled}
                onChange={(event) => setThinkingEnabled(event.target.checked)}
                className="h-4 w-4"
                />
                Think
            </label>

            <ModelPicker />
            </div>
      </div>
    </section>
  )
}