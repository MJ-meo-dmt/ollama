// src/components/workspaces/WorkspaceApi.tsx

import type {
  WorkspaceFileResponse,
  WorkspaceTreeResponse,
  WorkspaceWriteFileResponse,
  WorkspaceSetRootResponse,
} from "@/types/workspace-webview"

type WorkspaceWindow = Window & {
  selectWorkspaceDirectory?: () => void
  readWorkspaceTree?: (root: string) => Promise<WorkspaceTreeResponse>
  readWorkspaceFile?: (path: string) => Promise<WorkspaceFileResponse>
  writeWorkspaceFile?: (
    path: string,
    content: string,
  ) => Promise<WorkspaceWriteFileResponse>
  setWorkspaceRoot?: (path: string) => Promise<WorkspaceSetRootResponse>
}

export async function setWorkspaceRoot(
  path: string,
): Promise<WorkspaceSetRootResponse> {
  const directWindow = window as WorkspaceWindow

  const setFn = window.webview?.setWorkspaceRoot ?? directWindow.setWorkspaceRoot

  if (!setFn) {
    return {
      ok: false,
      error: "Workspace root API is not available",
    }
  }

  return setFn(path)
}

export function selectWorkspaceDirectory(): Promise<string | null> {
  return new Promise((resolve) => {
    const directWindow = window as WorkspaceWindow

    const selectFn =
      window.webview?.selectWorkspaceDirectory ??
      directWindow.selectWorkspaceDirectory

    if (!selectFn) {
      console.error("selectWorkspaceDirectory API is not available")
      resolve(null)
      return
    }

    window.__selectWorkspaceDirectoryCallback = (path) => {
      resolve(path)
      window.__selectWorkspaceDirectoryCallback = undefined
    }

    selectFn()
  })
}

export async function readWorkspaceTree(
  root: string,
): Promise<WorkspaceTreeResponse> {
  const directWindow = window as WorkspaceWindow

  const readFn =
    window.webview?.readWorkspaceTree ??
    directWindow.readWorkspaceTree

  if (!readFn) {
    return {
      ok: false,
      error: "Workspace tree API is not available",
    }
  }

  return readFn(root)
}

export async function readWorkspaceFile(
  path: string,
): Promise<WorkspaceFileResponse> {
  const directWindow = window as WorkspaceWindow

  const readFn =
    window.webview?.readWorkspaceFile ??
    directWindow.readWorkspaceFile

  if (!readFn) {
    return {
      ok: false,
      error: "Workspace file API is not available",
    }
  }

  return readFn(path)
}

export async function writeWorkspaceFile(
  path: string,
  content: string,
): Promise<WorkspaceWriteFileResponse> {
  const directWindow = window as WorkspaceWindow

  const writeFn =
    window.webview?.writeWorkspaceFile ?? directWindow.writeWorkspaceFile

  if (!writeFn) {
    return {
      ok: false,
      error: "Workspace write API is not available",
    }
  }

  return writeFn(path, content)
}