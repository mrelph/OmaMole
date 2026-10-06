/* Shared contract between the main process and the renderer. The renderer
   imports these as types only, so nothing here may have a runtime value. */

export type ViewId = 'overview' | 'clean' | 'disk' | 'dev' | 'packages' | 'system' | 'omarchy' | 'settings'

/* low: safe to apply automatically. medium: regenerable, but costs time or
   bandwidth to rebuild. review: touches something a person might want back. */
export type Risk = 'low' | 'medium' | 'review'

export type Status = 'good' | 'warning' | 'serious' | 'critical' | 'info'

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

export type ThemePayload = {
  name: string
  mode: 'light' | 'dark'
  /* Raw palette as --om-* custom properties; structure lives in CSS. */
  vars: Record<string, string>
  font: string
  radius: number
}

/* ------------------------------------------------------------------ */
/* Cleanup                                                             */
/* ------------------------------------------------------------------ */

export type CleanCategoryId =
  | 'pacman-cache'
  | 'pacman-uninstalled'
  | 'aur-cache'
  | 'journal'
  | 'coredumps'
  | 'thumbnails'
  | 'browser-cache'
  | 'dev-caches'
  | 'trash'
  | 'config-backups'

export type CleanCategory = {
  id: CleanCategoryId
  label: string
  description: string
  risk: Risk
  privileged: boolean
  /* Bytes this category would reclaim; null when it could not be measured. */
  bytes: number | null
  items: number | null
  detail?: string
  available: boolean
  reason?: string
  defaultSelected: boolean
}

export type CleanPreviewItem = { path: string; bytes: number }

export type CleanPreview = {
  id: CleanCategoryId
  items: CleanPreviewItem[]
  /* For privileged categories, the exact command the helper will run. */
  command?: string
  note?: string
}

export type CleanResult = {
  id: CleanCategoryId
  ok: boolean
  freedBytes: number
  message: string
}

/* ------------------------------------------------------------------ */
/* Overview / health scan                                              */
/* ------------------------------------------------------------------ */

export type TerminalActionId =
  | 'system-update'
  | 'orphans'
  | 'pacdiff'
  | 'snapshot'
  | 'btop'
  | 'debug'
  | 'unit-status'

export type RecommendationAction =
  | { kind: 'clean'; ids: CleanCategoryId[] }
  | { kind: 'view'; view: ViewId }
  | { kind: 'terminal'; action: TerminalActionId }

export type Recommendation = {
  id: string
  title: string
  detail: string
  risk: Risk
  status: Status
  action?: RecommendationAction
  /* Eligible for the one-key "fix low-risk" sweep. */
  auto: boolean
}

export type ScanReport = {
  score: number
  grade: 'Excellent' | 'Good' | 'Fair' | 'Poor'
  generatedAt: number
  disk: { mount: string; size: number; used: number; avail: number } | null
  memory: { total: number; available: number; swapTotal: number; swapFree: number }
  cleanableBytes: number
  failedUnits: number
  pendingUpdates: number | null
  orphans: number
  recommendations: Recommendation[]
  skipped: string[]
}

/* ------------------------------------------------------------------ */
/* Disk                                                                */
/* ------------------------------------------------------------------ */

export type DiskMode = 'folders' | 'files' | 'types' | 'old'

export type DiskEntry = {
  path: string
  name: string
  bytes: number
  kind: 'dir' | 'file' | 'type'
  count?: number
  mtimeMs?: number
}

export type DiskReport = {
  root: string
  mode: DiskMode
  entries: DiskEntry[]
  totalBytes: number
  fs: { size: number; used: number; avail: number } | null
  elapsedMs: number
  truncated: boolean
}

/* ------------------------------------------------------------------ */
/* Developer artifacts                                                 */
/* ------------------------------------------------------------------ */

export type DevArtifact = {
  path: string
  kind: string
  project: string
  bytes: number
  mtimeMs: number
}

export type DevReport = {
  root: string
  artifacts: DevArtifact[]
  totalBytes: number
  elapsedMs: number
  truncated: boolean
}

export type RemoveResult = { path: string; ok: boolean; bytes: number; message?: string }

/* ------------------------------------------------------------------ */
/* Packages                                                            */
/* ------------------------------------------------------------------ */

export type PackageUpdate = { name: string; from: string; to: string; source: 'repo' | 'aur' }

export type PackagesReport = {
  installed: number
  explicit: number
  foreign: { name: string; version: string }[]
  orphans: { name: string; version: string; bytes: number }[]
  updates: PackageUpdate[] | null
  updatesError?: string
  pacnew: string[]
  largest: { name: string; bytes: number }[]
  cacheBytes: number | null
  aurHelper: string | null
}

/* ------------------------------------------------------------------ */
/* System                                                              */
/* ------------------------------------------------------------------ */

export type ProcessInfo = {
  pid: number
  name: string
  cpu: number
  rssBytes: number
  command: string
}

export type FailedUnit = { unit: string; scope: 'system' | 'user'; description: string }

export type Filesystem = { source: string; fstype: string; mount: string; size: number; used: number; avail: number }

export type SystemReport = {
  hostname: string
  kernel: string
  uptimeSec: number
  boot: string | null
  cpuModel: string
  cpuCount: number
  load: [number, number, number]
  memory: {
    total: number
    available: number
    used: number
    buffers: number
    cached: number
    swapTotal: number
    swapFree: number
    zswap: number | null
  }
  byCpu: ProcessInfo[]
  byMemory: ProcessInfo[]
  failedUnits: FailedUnit[]
  filesystems: Filesystem[]
}

/* ------------------------------------------------------------------ */
/* Omarchy + Hyprland                                                  */
/* ------------------------------------------------------------------ */

export type OmarchyReport = {
  present: boolean
  version: string | null
  channel: string | null
  update: string[] | null
  theme: string | null
  font: string | null
  hyprland: {
    version: string | null
    configErrors: string[]
    monitors: { name: string; description: string; width: number; height: number; refresh: number; scale: number }[]
  } | null
  backups: { path: string; bytes: number; mtimeMs: number }[]
  snapshots: { count: number | null; latest: string | null; error?: string }
  plugins: string[]
  hooks: string[]
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export type Settings = {
  devRoots: string[]
  devOlderThanDays: number
  journalMaxSize: string
  paccacheKeep: number
  diskRoot: string
  excludePaths: string[]
}

export type AppInfo = {
  version: string
  electron: string
  omarchy: boolean
  helperPath: string
  home: string
}

/* ------------------------------------------------------------------ */
/* Bridge                                                              */
/* ------------------------------------------------------------------ */

export type OmamoleBridge = {
  app: () => Promise<AppInfo>
  theme: () => Promise<ThemePayload>
  onTheme: (callback: (theme: ThemePayload) => void) => () => void
  onFocus: (callback: () => void) => () => void
  scan: (force?: boolean) => Promise<ScanReport>
  cleanList: (force?: boolean) => Promise<CleanCategory[]>
  cleanPreview: (id: CleanCategoryId) => Promise<CleanPreview>
  cleanRun: (ids: CleanCategoryId[]) => Promise<CleanResult[]>
  disk: (root: string, mode: DiskMode, limit: number) => Promise<DiskReport>
  devScan: (root: string, olderThanDays: number) => Promise<DevReport>
  devRemove: (paths: string[]) => Promise<RemoveResult[]>
  packages: (force?: boolean) => Promise<PackagesReport>
  system: () => Promise<SystemReport>
  omarchy: (force?: boolean) => Promise<OmarchyReport>
  terminal: (action: TerminalActionId, arg?: string, userScope?: boolean) => Promise<{ ok: boolean; message: string }>
  reveal: (target: string) => Promise<void>
  trash: (paths: string[]) => Promise<RemoveResult[]>
  pickFolder: (start?: string) => Promise<string | null>
  settings: () => Promise<Settings>
  saveSettings: (settings: Settings) => Promise<Settings>
}
