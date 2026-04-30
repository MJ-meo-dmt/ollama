import { useEffect, useRef, useState } from "react"
import StreamingMarkdownContent from "@/components/StreamingMarkdownContent"
import ollama from "ollama/browser"
import type { WorkspaceNode } from "@/types/workspace-webview"
import { readWorkspaceFile } from "./workspaceApi"
import type { WorkspacePatchProposal } from "./patchTypes"
import { ModelPicker } from "@/components/ModelPicker"
import { useSelectedModel } from "@/hooks/useSelectedModel"

const GUIDANCE_MAX_CHARS = 12000
const SELECTED_FILE_MAX_CHARS = 30000
const EXTRA_FILE_MAX_CHARS = 20000
const MAX_CONTEXT_AUTO_ROUNDS = 2
const CHAT_STORAGE_KEY = "workspace_chat_messages"

const WORKSPACE_COMMANDS = [
  { name: "@ask", description: "Ask or explain" },
  { name: "@context", description: "Show loaded context" },
  { name: "@plan", description: "Plan changes" },
  { name: "@patch", description: "Propose editable patch" },
]

type ContextRequest = {
  type: "context_request" | "read_file"
  reason?: string
  files?: string[]
  path?: string
}

type LoadedContextFile = {
  path: string
  content: string
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

function trimText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value
  }

  return `${value.slice(0, maxChars)}

...[trimmed ${value.length - maxChars} chars]`
}

function formatContextFile(
  label: string,
  content: string,
  maxChars: number,
) {
  const isTrimmed = content.length > maxChars

  return `--- ${label} ---
STATUS: ${isTrimmed ? `PARTIAL, showing first ${maxChars} of ${content.length} chars` : "FULL"}
CONTENT:
${trimText(content, maxChars)}`
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
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const { selectedModel } = useSelectedModel()

  const [commandMenuOpen, setCommandMenuOpen] = useState(false)
  const [commandIndex, setCommandIndex] = useState(0)

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

  const handleSend = async () => {
    const userMessage = message.trim()
    let extraContextFiles: LoadedContextFile[] = []

    if (!userMessage || isRunning) {
      return
    }

    const parsed = parseWorkspaceCommand(userMessage)

    if (parsed.command === "context") {
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

    **Selected file:** ${selectedFile || "none"}

    **Selected file status:** ${
            selectedFile
              ? selectedFileContent.length > SELECTED_FILE_MAX_CHARS
                ? `PARTIAL (${SELECTED_FILE_MAX_CHARS} of ${selectedFileContent.length} chars)`
                : `FULL (${selectedFileContent.length} chars)`
              : "none"
          }

    **Active guidance files:** ${guidanceFiles.length}

    ${guidanceFiles.map((file) => `- ${file.relPath || file.name}`).join("\n") || "- none"}

    **Workspace map:** ${workspaceMap ? "loaded" : "not loaded"}`,
        },
      ])

      return
    }

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
      const guidanceContents = await Promise.all(
        guidanceFiles.slice(0, 8).map(async (file) => {
          const result = await readWorkspaceFile(file.path)

          return {
            relPath: file.relPath || file.name,
            content: result.ok
              ? result.content || ""
              : `[failed to read: ${result.error}]`,
          }
        }),
      )

      const chatHistory = messages
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

      const commandRules =
        parsed.command === "patch"
          ? `PATCH MODE RULES:
  - Return ONLY valid JSON.
  - Do not include markdown fences.
  - Do not explain outside the JSON.
  ${contextRequestRules}
  - If required context is missing, request context first instead of guessing.
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
  - If the user asks to read a file, request it as context first, then after it is loaded, show or summarize the file content.
  - Explain clearly.
  - Use workspace guidance first.
  - Do not claim files were edited.
  - If code changes are needed, suggest them but do not apply them.
  ${contextRequestRules}`

      const buildPrompt = (extraFiles: LoadedContextFile[]) => `You are the Ollama Workspace Agent.

  You are working inside a local workspace.

  WORKSPACE ROOT:
  ${workspacePath || "No workspace selected"}

  WORKSPACE MAP:
  ${workspaceMap || "No workspace map available."}

  ACTIVE GUIDANCE FILES:
  ${
    guidanceContents
      .map((file) =>
        formatContextFile(
          file.relPath,
          file.content,
          GUIDANCE_MAX_CHARS,
        ),
      )
      .join("\n\n") || "No guidance files detected."
  }

  SELECTED FILE:
  ${selectedFile || "No file selected"}

  ${
    selectedFile
      ? formatContextFile(
          selectedFile,
          selectedFileContent,
          SELECTED_FILE_MAX_CHARS,
        )
      : "SELECTED FILE CONTENT:\nNo file selected."
  }

  EXTRA CONTEXT FILES:
  ${
    extraFiles.length
      ? extraFiles
          .map((file) =>
    formatContextFile(file.path, file.content, EXTRA_FILE_MAX_CHARS),
  )
          .join("\n\n")
      : "No extra context loaded."
  }

  AUTO CONTEXT STATE:
  ${
    extraFiles.length > 0
      ? "Extra context has already been loaded. Continue the user's task using the loaded context. Do not request the same file again."
      : "No auto-loaded context yet."
  }

  CONTEXT SUMMARY:
  - Active guidance files: ${guidanceContents.length}
  - Selected file loaded: ${selectedFile ? "yes" : "no"}
  - Selected file chars: ${selectedFile ? selectedFileContent.length : 0}
  - Extra context files loaded this round: ${extraFiles.length}

  RECENT CHAT HISTORY:
  ${chatHistory || "No previous chat history."}

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
          content: "",
        },
      ])
      const loadedContextPaths = new Set<string>()
      for (let round = 0; round <= MAX_CONTEXT_AUTO_ROUNDS; round++) {
        fullResponse = ""

        const stream = await ollama.generate({
          model: selectedModel?.model || "qwen3.5:9b",
          prompt: buildPrompt(extraContextFiles),
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
          .filter((path) => !loadedContextPaths.has(path))

        if (requestedFiles.length === 0) {
          const continuePrompt = `${buildPrompt(extraContextFiles)}

        IMPORTANT:
        The requested context is already loaded above. Do not request more context.
        Continue the user's task now using the loaded context.`

          fullResponse = ""

          const continueStream = await ollama.generate({
            model: selectedModel?.model || "qwen3.5:9b",
            prompt: continuePrompt,
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

        setMessages((prev) => {
          const next = [...prev]
          const lastIndex = next.length - 1

          if (lastIndex >= 0 && next[lastIndex].role === "assistant") {
            next[lastIndex] = {
              ...next[lastIndex],
              content: `Loading requested context:\n\n${requestedFiles
                .map((file) => `- ${file}`)
                .join("\n")}`,
            }
          }

          return next
        })

        const loaded = await Promise.all(
          requestedFiles.map(async (path) => {
            loadedContextPaths.add(path)

            const result = await readWorkspaceFile(path)

            return {
              path,
              content: result.ok
                ? result.content || ""
                : `[failed to read: ${result.error}]`,
            }
          }),
        )

        extraContextFiles = [...extraContextFiles, ...loaded]
      }

      if (parsed.command === "patch") {
        try {
          const proposal = JSON.parse(fullResponse) as WorkspacePatchProposal

          if (proposal.type === "patch_proposal") {
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
        } catch {
          setError("Patch response was not valid JSON.")
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
      <div className="border-b border-neutral-300 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="font-medium dark:text-white">Workspace Chat</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Uses selected file + guidance files as context.
        </p>
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
                <StreamingMarkdownContent
                    content={item.content}
                    isStreaming={isRunning && index === messages.length - 1}
                    size="sm"
                />
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
                setCommandIndex((prev) => (prev + 1) % WORKSPACE_COMMANDS.length)
                return
              }

              if (event.key === "ArrowUp") {
                event.preventDefault()
                setCommandIndex((prev) =>
                  prev === 0 ? WORKSPACE_COMMANDS.length - 1 : prev - 1,
                )
                return
              }

              if (event.key === "Tab" || event.key === "Enter") {
                event.preventDefault()
                selectCommand(WORKSPACE_COMMANDS[commandIndex].name)
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
            {WORKSPACE_COMMANDS.map((command, index) => (
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