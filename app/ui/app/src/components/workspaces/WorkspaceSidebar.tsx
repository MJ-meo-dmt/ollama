type RecentWorkspace = {
  name: string
  path: string
  openedAt: number
}

type WorkspaceSidebarProps = {
  recentWorkspaces: RecentWorkspace[]
  activeWorkspacePath: string | null
  onSelectWorkspace: (path: string) => void
}

export function WorkspaceSidebar({
  recentWorkspaces,
  activeWorkspacePath,
  onSelectWorkspace,
}: WorkspaceSidebarProps) {
  return (
    <aside className="flex h-full flex-col px-3 pb-3 text-sm dark:text-white">
      <div className="px-2 pb-3">
        <h2 className="font-rounded text-lg font-medium">Workspaces</h2>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Recent local projects
        </p>
      </div>

      <div className="space-y-1">
        {recentWorkspaces.length === 0 ? (
          <div className="px-3 py-2 text-xs text-neutral-500">
            No recent workspaces yet.
          </div>
        ) : (
          recentWorkspaces.map((workspace) => {
            const isActive = workspace.path === activeWorkspacePath

            return (
              <button
                key={workspace.path}
                onClick={() => onSelectWorkspace(workspace.path)}
                title={workspace.path}
                className={`block w-full rounded-lg px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                  isActive ? "bg-neutral-100 dark:bg-neutral-800" : ""
                }`}
              >
                <div className="truncate font-medium">{workspace.name}</div>
                <div className="mt-0.5 truncate text-xs text-neutral-500">
                  {workspace.path}
                </div>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}