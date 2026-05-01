// src/components/workspaces/patchTypes.ts

export type WorkspacePatchAnchors = {
  before?: string
  after?: string
}

export type WorkspacePatchFile = {
  path: string
  action: "edit" | "create" | "delete"
  original_snippet: string
  replacement_snippet: string
  reason: string
  anchors?: WorkspacePatchAnchors
}

export type WorkspacePatchProposal = {
  type: "patch_proposal"
  summary: string
  files: WorkspacePatchFile[]
  notes?: string[]
}