// src/components/workspaces/WorkspaceEditor.tsx

type WorkspaceEditorProps = {
  selectedFile: string | null
  content: string
  error?: string | null
}

export function WorkspaceEditor({
  selectedFile,
  content,
  error,
}: WorkspaceEditorProps) {
  return (
    <section className="h-full overflow-hidden bg-neutral-100 dark:bg-neutral-950">
      <div className="flex h-11 items-center border-b border-neutral-300 bg-neutral-50 px-4 dark:border-neutral-800 dark:bg-neutral-900">
        <span className="truncate text-sm font-medium dark:text-white">
          {selectedFile || "No file selected"}
        </span>
      </div>

      <div className="h-full overflow-auto p-4">
        {error && (
          <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        <pre className="rounded-xl bg-neutral-50 p-4 whitespace-pre-wrap font-mono text-sm text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
          {selectedFile ? content : "Open a workspace and select a file."}
        </pre>
      </div>
    </section>
  )
}