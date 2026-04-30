import { mockWorkspace } from "./WorkspacePage"

export function WorkspaceExplorer() {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="font-medium dark:text-white">Explorer</h2>
      <p className="mt-1 text-xs text-neutral-500">{mockWorkspace.path}</p>

      <div className="mt-4 space-y-1 text-sm">
        {mockWorkspace.files.map((file) => (
          <div
            key={file}
            className="rounded-md px-2 py-1 text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {file}
          </div>
        ))}
      </div>
    </section>
  )
}