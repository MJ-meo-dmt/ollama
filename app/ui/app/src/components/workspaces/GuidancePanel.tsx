import { mockWorkspace } from "./WorkspacePage"

export function GuidancePanel() {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h1 className="font-rounded text-xl font-medium dark:text-white">
        {mockWorkspace.name}
      </h1>

      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Active guidance chain
      </p>

      <div className="mt-5 space-y-2">
        {mockWorkspace.guidance.map((file, index) => (
          <div
            key={file}
            className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <div className="text-xs text-neutral-500">Step {index + 1}</div>
            <div className="mt-1 font-mono text-sm dark:text-white">{file}</div>
          </div>
        ))}
      </div>
    </section>
  )
}