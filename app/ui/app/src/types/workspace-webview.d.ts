export {}

declare global {
  interface Window {
    __selectWorkspaceDirectoryCallback?: (path: string | null) => void

    selectWorkspaceDirectory?: () => void
    readWorkspaceTree?: (root: string) => Promise<WorkspaceTreeResponse>
    readWorkspaceFile?: (path: string) => Promise<WorkspaceFileResponse>
    writeWorkspaceFile?: (path: string, content: string) => Promise<WorkspaceWriteFileResponse>
    setWorkspaceRoot?: (path: string) => Promise<WorkspaceSetRootResponse>

    webview?: {
        selectWorkspaceDirectory?: () => void
        readWorkspaceTree?: (root: string) => Promise<WorkspaceTreeResponse>
        readWorkspaceFile?: (path: string) => Promise<WorkspaceFileResponse>
        writeWorkspaceFile?: (path: string, content: string) => Promise<WorkspaceWriteFileResponse>
        setWorkspaceRoot?: (path: string) => Promise<WorkspaceSetRootResponse>

        selectModelsDirectory?: () => Promise<string | null>
        selectWorkingDirectory?: () => Promise<string | null>
    }
    }
}

export type WorkspaceNode = {
  name: string
  path: string
  relPath: string
  type: "file" | "folder"
  children?: WorkspaceNode[]
}

export type WorkspaceTreeResponse = {
  ok: boolean
  error?: string
  root?: WorkspaceNode
}

export type WorkspaceFileResponse = {
  ok: boolean
  error?: string
  path?: string
  content?: string
}

export type WorkspaceWriteFileResponse = {
  ok: boolean
  error?: string
  path?: string
}

export type WorkspaceSetRootResponse = {
  ok: boolean
  error?: string
  path?: string
}