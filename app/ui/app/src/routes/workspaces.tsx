// src/routes/workspaces.tsx

import { createFileRoute } from "@tanstack/react-router"
import WorkspacePage from "@/components/workspaces/WorkspacePage"

export const Route = createFileRoute("/workspaces")({
  component: WorkspacePage,
})