import { createContext, useContext, useEffect, useRef } from 'react'
import type { AppInfo, OmamoleBridge, ViewId } from '../../src-electron/types'

export type KeyHandler = (event: KeyboardEvent) => boolean | void

export type ConfirmOptions = {
  title: string
  body: React.ReactNode
  confirmLabel: string
  danger?: boolean
  glyph?: string
}

export type ToastTone = 'normal' | 'urgent'

export type AppApi = {
  bridge: OmamoleBridge
  info: AppInfo | null
  /* True when the content column (not the nav) owns the keyboard. */
  active: boolean
  go: (view: ViewId) => void
  focusNav: () => void
  toast: (message: string, detail?: string, tone?: ToastTone) => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
  setStatus: (message: string) => void
  registerKeys: (handler: { current: KeyHandler }) => () => void
  registerRefresh: (refresh: { current: () => void }) => () => void
}

export const AppContext = createContext<AppApi | null>(null)

export function useApp(): AppApi {
  const api = useContext(AppContext)
  if (!api) throw new Error('useApp outside provider')
  return api
}

/* Registers a key handler for the lifetime of the component. The latest
   closure is always used, so handlers can read fresh state without
   re-registering on every render. Return true to consume the key. */
export function useKeys(handler: KeyHandler, enabled = true) {
  const { registerKeys } = useApp()
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!enabled) return
    return registerKeys(ref)
  }, [enabled, registerKeys])
}

export const isTyping = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null
  return !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
}

/* Lets a view that owns its own data answer `r` and the toolbar's Refresh. */
export function useRefresh(refresh: () => void) {
  const { registerRefresh } = useApp()
  const ref = useRef(refresh)
  ref.current = refresh
  useEffect(() => registerRefresh(ref), [registerRefresh])
}
