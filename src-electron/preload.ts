import { contextBridge, ipcRenderer } from 'electron'
import type { OmamoleBridge, ThemePayload } from './types'

const bridge: OmamoleBridge = {
  app: () => ipcRenderer.invoke('app:info'),
  theme: () => ipcRenderer.invoke('theme:get'),
  onTheme: (callback) => {
    const listener = (_event: unknown, theme: ThemePayload) => callback(theme)
    ipcRenderer.on('theme:changed', listener)
    return () => ipcRenderer.removeListener('theme:changed', listener)
  },
  onFocus: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('app:focus', listener)
    return () => ipcRenderer.removeListener('app:focus', listener)
  },
  scan: (force) => ipcRenderer.invoke('scan', force),
  cleanList: (force) => ipcRenderer.invoke('clean:list', force),
  cleanPreview: (id) => ipcRenderer.invoke('clean:preview', id),
  cleanRun: (ids) => ipcRenderer.invoke('clean:run', ids),
  disk: (root, mode, limit) => ipcRenderer.invoke('disk', root, mode, limit),
  devScan: (root, olderThanDays) => ipcRenderer.invoke('dev:scan', root, olderThanDays),
  devRemove: (paths) => ipcRenderer.invoke('dev:remove', paths),
  packages: (force) => ipcRenderer.invoke('packages', force),
  system: () => ipcRenderer.invoke('system'),
  omarchy: (force) => ipcRenderer.invoke('omarchy', force),
  terminal: (action, arg, userScope) => ipcRenderer.invoke('terminal', action, arg, userScope),
  reveal: (target) => ipcRenderer.invoke('reveal', target),
  trash: (paths) => ipcRenderer.invoke('trash', paths),
  pickFolder: (start) => ipcRenderer.invoke('pick-folder', start),
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  update: (force) => ipcRenderer.invoke('update', force),
  restart: () => ipcRenderer.invoke('restart')
}

contextBridge.exposeInMainWorld('omamole', bridge)
