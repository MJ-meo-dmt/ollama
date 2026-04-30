import { Link } from "@tanstack/react-router"

export function WorkspaceSidebar() {
  return (
    <aside className="flex h-full flex-col px-3 pb-3 text-sm dark:text-white">
      <div className="px-2 pb-3">
        <h2 className="font-rounded text-lg font-medium">Workspaces</h2>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Local project agents
        </p>
      </div>

      <div className="space-y-1">
        <Link
          to="/workspaces"
          className="block rounded-lg px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          Mock Workspace
        </Link>
      </div>
    </aside>
  )
}