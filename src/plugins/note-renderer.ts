import type { ComponentType, LazyExoticComponent } from "react"

import type { VaultAsset } from "@/services/vault/vault-adapter"

export type NoteRendererPluginProps = {
  content: string
  editable?: boolean
  immersive?: boolean
  noteId?: string
  onContentChange?: (content: string) => void
  onResolveAsset: (source: string) => Promise<VaultAsset | null>
  onWikiLink: (target: string) => void
}

export type OfficialNoteRendererPlugin = {
  component: LazyExoticComponent<ComponentType<NoteRendererPluginProps>>
  id: `official.${string}`
  label: string
  match: (content: string) => boolean
  official: true
}
