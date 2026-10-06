/// <reference types="vite/client" />
import type { OmamoleBridge } from '../src-electron/types'

declare global {
  interface Window {
    omamole?: OmamoleBridge
  }
}
