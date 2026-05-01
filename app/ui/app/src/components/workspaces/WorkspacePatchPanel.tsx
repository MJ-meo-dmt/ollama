// src/components/workspaces/WorkspacePatchPanel.tsx

import type { WorkspacePatchProposal } from "./patchTypes"
import type { PatchMatchResult } from "./patchMatcher"

type WorkspacePatchPanelProps = {
  proposal: WorkspacePatchProposal
  matchResults?: Record<string, PatchMatchResult>
  onClear: () => void
  onApply: () => void
}

export function WorkspacePatchPanel({
  proposal,
  matchResults = {},
  onClear,
  onApply
}: WorkspacePatchPanelProps) {
  return (
    <section className="border-t border-neutral-300 bg-neutral-100 p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-medium dark:text-white">Patch Proposal</h2>
          <p className="mt-1 text-sm text-neutral-500">{proposal.summary}</p>
        </div>

        <button
          onClick={onClear}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-700 dark:text-white"
        >
          Clear
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {proposal.files.map((file, index) => {
          const match = matchResults[file.path]

          return (
            <div
              key={`${file.path}-${index}`}
              className="rounded-xl border border-neutral-300 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="border-b border-neutral-200 p-3 dark:border-neutral-800">
                <div className="font-mono text-sm dark:text-white">
                  {file.action.toUpperCase()} {file.path}
                </div>

                <p className="mt-1 text-xs text-neutral-500">{file.reason}</p>

                {match && (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded bg-neutral-200 px-2 py-0.5 font-mono text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                      match: {match.method}
                    </span>

                    <span className="rounded bg-neutral-200 px-2 py-0.5 font-mono text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                      confidence: {Math.round(match.confidence * 100)}%
                    </span>

                    {match.startLine !== undefined && match.endLine !== undefined && (
                      <span className="rounded bg-neutral-200 px-2 py-0.5 font-mono text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                        lines: {match.startLine}-{match.endLine}
                      </span>
                    )}

                    {!match.ok && match.reason && (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                        {match.reason}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-0 text-xs">
                <div className="border-r border-neutral-200 p-3 dark:border-neutral-800">
                  <div className="mb-2 font-medium text-red-600">Original</div>
                  <pre className="whitespace-pre-wrap font-mono dark:text-neutral-200">
                    {file.original_snippet || "(empty)"}
                  </pre>
                </div>

                <div className="p-3">
                  <div className="mb-2 font-medium text-green-600">
                    Replacement
                  </div>
                  <pre className="whitespace-pre-wrap font-mono dark:text-neutral-200">
                    {file.replacement_snippet || "(empty)"}
                  </pre>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {proposal.notes && proposal.notes.length > 0 && (
        <div className="mt-4 rounded-xl bg-neutral-50 p-3 text-sm dark:bg-neutral-800 dark:text-neutral-200">
          <div className="font-medium">Notes</div>
          <ul className="mt-2 list-disc pl-5">
            {proposal.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      )}

    <button
      type="button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        console.log("Patch apply button clicked")
        onApply()
      }}
      className="mt-4 w-full rounded-lg bg-black px-3 py-2 text-sm text-white dark:bg-white dark:text-black"
    >
      Apply patch
    </button>
    </section>
  )
}