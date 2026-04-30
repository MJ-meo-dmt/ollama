// src/components/workspaces/WorkspacePage.tsx

import { SidebarLayout } from "@/components/layout/layout"
import { WorkspaceSidebar } from "./WorkspaceSidebar"
import { WorkspaceExplorer } from "./WorkspaceExplorer"
import { GuidancePanel } from "./GuidancePanel"
import { AgentPanel } from "./AgentPanel"
import { useNavigate } from "@tanstack/react-router"
import { ArrowLeftIcon } from "@heroicons/react/20/solid"

export default function WorkspacePage() {
  const navigate = useNavigate()

  const handleBack = () => {
    navigate({ to: "/c/$chatId", params: { chatId: "new" } })
  }

  return (
    <SidebarLayout sidebar={<WorkspaceSidebar />}>
      <main className="flex h-screen w-full flex-col dark:bg-neutral-900">
        <header className="w-full flex flex-none justify-between h-[52px] py-2.5 items-center border-b border-neutral-200 dark:border-neutral-800">
          <h1 className="pl-4 flex items-center font-rounded text-md font-medium dark:text-white">
            <button
              onClick={handleBack}
              className="hover:bg-neutral-100 mr-3 dark:hover:bg-neutral-800 rounded-full p-1.5"
            >
              <ArrowLeftIcon className="w-5 h-5 dark:text-white" />
            </button>
            Workspaces
          </h1>
        </header>

        <div className="flex-1 grid grid-cols-[280px_1fr_360px] gap-4 p-4 overflow-hidden">
          <WorkspaceExplorer />
          <GuidancePanel />
          <AgentPanel />
        </div>
      </main>
    </SidebarLayout>
  )
}

export const mockWorkspace = {
  name: "network-graph-monitor",
  path: "P:/Development/2026/network-graph-monitor",
  guidance: [
    "START_HERE.md",
    "context.md",
    "rules.md",
    "src/context.md",
    "frontend/context.md",
  ],
  files: [
    "START_HERE.md",
    "context.md",
    "src/main.js",
    "src/state.js",
    "src/graph_builder.py",
    "src/heuristics.py",
  ],
}