import type { WorkspacePatchProposal } from "./patchTypes"

type WorkspacePatchPanelProps = {
  proposal: WorkspacePatchProposal
  onClear: () => void
  onApply: () => void
}

export function WorkspacePatchPanel({
  proposal,
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
        {proposal.files.map((file, index) => (
          <div
            key={`${file.path}-${index}`}
            className="rounded-xl border border-neutral-300 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="border-b border-neutral-200 p-3 dark:border-neutral-800">
              <div className="font-mono text-sm dark:text-white">
                {file.action.toUpperCase()} {file.path}
              </div>
              <p className="mt-1 text-xs text-neutral-500">{file.reason}</p>
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
        ))}
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