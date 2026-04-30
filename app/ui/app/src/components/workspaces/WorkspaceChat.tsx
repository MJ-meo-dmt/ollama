import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import ollama from "ollama/browser"
import type { WorkspaceNode } from "@/types/workspace-webview"
import { readWorkspaceFile } from "./workspaceApi"
import type { WorkspacePatchProposal } from "./patchTypes"

type WorkspaceChatProps = {
  workspacePath: string | null
  selectedFile: string | null
  selectedFileContent: string
  guidanceFiles: WorkspaceNode[]
  onPatchProposal?: (proposal: WorkspacePatchProposal) => void
}

type WorkspaceCommand = "ask" | "plan" | "patch"

type ChatMessage = {
  role: "user" | "assistant"
  content: string
}

function trimText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value
  }

  return `${value.slice(0, maxChars)}

...[trimmed ${value.length - maxChars} chars]`
}

function parseWorkspaceCommand(input: string): {
  command: WorkspaceCommand
  task: string
} {
  const trimmed = input.trim()
  const match = trimmed.match(/^@(\w+)\s+(.*)$/s)

  if (!match) {
    return { command: "ask", task: trimmed }
  }

  const rawCommand = match[1].toLowerCase()
  const task = match[2].trim()

  if (rawCommand === "plan") {
    return { command: "plan", task }
  }

  if (rawCommand === "patch") {
    return { command: "patch", task }
  }

  return { command: "ask", task: trimmed }
}

export function WorkspaceChat({
  workspacePath,
  selectedFile,
  selectedFileContent,
  guidanceFiles,
  onPatchProposal,
}: WorkspaceChatProps) {
  const [message, setMessage] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const [thinkingEnabled, setThinkingEnabled] = useState(false)

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
    const parsed = parseWorkspaceCommand(userMessage)

    if (!userMessage || isRunning) {
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

      const commandRules =
  parsed.command === "patch"
    ? `PATCH MODE RULES:
- Return ONLY valid JSON.
- Do not include markdown fences.
- Do not explain outside the JSON.
- Use this shape:
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
- Mention which files should be inspected or changed.`
      : `ASK MODE RULES:
- Explain clearly.
- Use workspace guidance first.
- Do not claim files were edited.
- If code changes are needed, suggest them but do not apply them.`

      const prompt = `You are the Ollama Workspace Agent.

You are working inside a local workspace.

WORKSPACE ROOT:
${workspacePath || "No workspace selected"}

ACTIVE GUIDANCE FILES:
${
  guidanceContents
    .map(
      (file) => `--- ${file.relPath} ---
${trimText(file.content, 3000)}`,
    )
    .join("\n\n") || "No guidance files detected."
}

SELECTED FILE:
${selectedFile || "No file selected"}

SELECTED FILE CONTENT:
${selectedFile ? trimText(selectedFileContent, 8000) : "No file selected."}

RECENT CHAT HISTORY:
${chatHistory || "No previous chat history."}

COMMAND:
@${parsed.command}

USER TASK:
${parsed.task}

RULES:
${commandRules}
`

      const result = await ollama.generate({
        model: "qwen3.5:9b",
        prompt,
        stream: false,
        think: thinkingEnabled,
      })

      if (parsed.command === "patch") {
    try {
        const proposal = JSON.parse(result.response) as WorkspacePatchProposal

        if (proposal.type === "patch_proposal") {
        onPatchProposal?.(proposal)
        }
    } catch {
        setError("Patch response was not valid JSON.")
    }
    }

    setMessages((prev) => [
    ...prev,
    {
        role: "assistant",
        content:
        parsed.command === "patch"
            ? "Patch proposal generated. Review it in the patch panel."
            : result.response,
    },
    ])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Workspace chat failed")
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <section className="flex h-full flex-col overflow-hidden border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="font-medium dark:text-white">Workspace Chat</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Uses selected file + guidance files as context.
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4 text-sm">
        <div className="rounded-xl bg-neutral-50 p-3 text-xs dark:bg-neutral-800 dark:text-neutral-300">
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
                  : "bg-neutral-50 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
              }`}
            >
              <div className="mb-1 text-xs font-medium opacity-70">
                {item.role === "user" ? "You" : "Workspace Agent"}
              </div>
              {item.role === "assistant" ? (
                <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {item.content}
                    </ReactMarkdown>
                </div>
                ) : (
                <pre className="whitespace-pre-wrap font-sans text-sm">
                    {item.content}
                </pre>
                )}
            </div>
          ))}

          {isRunning && (
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

      <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              handleSend()
            }
          }}
          placeholder="@ask explain this file, @plan change X, @patch edit selected file..."
          className="h-24 w-full resize-none rounded-lg border border-neutral-200 bg-white p-3 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white"
        />

        <div className="mt-2 flex items-center gap-2">
            <button
                onClick={handleSend}
                disabled={isRunning || !message.trim()}
                className="flex-1 rounded-lg bg-black px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black">
                {isRunning ? thinkingEnabled ? "Thinking..."
                    : "Working..."
                    : "Send to workspace model"}
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
            </div>
      </div>
    </section>
  )
}