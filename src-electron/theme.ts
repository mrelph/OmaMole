import { readFile, stat } from 'node:fs/promises'
import { watch } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run, which } from './exec'
import type { ThemePayload } from './types'

/* The palette comes from the active Omarchy theme and is handed to the
   renderer as raw --om-* role variables, mirroring the Omarchy Design
   System's tokens/omarchy.css. Structure (fills, separators, dim text) is
   derived from those roles in CSS, so nothing here knows about components.

   Path is XDG *state*, not config. `omarchy-theme-set` replaces the whole
   `theme` directory with rm -rf + mv, so the watcher sits on the containing
   directory, never on colors.toml's inode. */

const CURRENT_DIR = path.join(os.homedir(), '.local', 'state', 'omarchy', 'current')
const THEME_DIR = path.join(CURRENT_DIR, 'theme')
const COLORS_PATH = path.join(THEME_DIR, 'colors.toml')
const THEME_NAME_PATH = path.join(CURRENT_DIR, 'theme.name')

type Rgb = { r: number; g: number; b: number }

export const isHex = (value: string | undefined): value is string =>
  !!value && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())

export const hexToRgb = (hex: string): Rgb => {
  let body = hex.trim().replace(/^#/, '')
  if (body.length === 3) body = body.split('').map((c) => c + c).join('')
  return { r: parseInt(body.slice(0, 2), 16), g: parseInt(body.slice(2, 4), 16), b: parseInt(body.slice(4, 6), 16) }
}

export const rgbToHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`

export const normalizeHex = (hex: string): string => rgbToHex(hexToRgb(hex))

export const luminance = (hex: string): number => {
  const { r, g, b } = hexToRgb(hex)
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

export const mix = (a: string, b: string, t: number): string => {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t })
}

/* Flat key = "value" lines only; colors.toml has no tables we need. */
export const parseColorsToml = (text: string): Record<string, string> => {
  const table: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('[')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    const quote = value[0]
    if (quote === '"' || quote === "'") {
      const end = value.indexOf(quote, 1)
      value = end === -1 ? value.slice(1) : value.slice(1, end)
    } else {
      value = value.replace(/\s+#.*$/, '')
    }
    if (key) table[key] = value
  }
  return table
}

const PALETTE_KEYS = [
  'accent', 'selection', 'muted',
  'background', 'dark_background', 'darker_background', 'lighter_background',
  'foreground', 'dark_foreground', 'light_foreground', 'bright_foreground',
  'red', 'yellow', 'orange', 'green', 'cyan', 'blue', 'magenta', 'brown',
  'bright_red', 'bright_yellow', 'bright_green', 'bright_cyan', 'bright_blue', 'bright_magenta'
] as const

/* Off Omarchy there is no theme to follow: a neutral dark palette, so the
   app still renders, and nothing else changes. */
const FALLBACK: Record<string, string> = {
  accent: '#7aa2f7', background: '#1a1b26', foreground: '#c0caf5', muted: '#565f89',
  red: '#f7768e', yellow: '#e0af68', orange: '#ff9e64', green: '#9ece6a', cyan: '#7dcfff',
  blue: '#7aa2f7', magenta: '#bb9af7', brown: '#8c6c3e'
}

export function buildPalette(colors: Record<string, string>, modeHint?: string): { mode: 'light' | 'dark'; vars: Record<string, string> } {
  const pick = (key: string): string | undefined => (isHex(colors[key]) ? normalizeHex(colors[key]) : undefined)
  const background = pick('background') ?? FALLBACK.background
  const foreground = pick('foreground') ?? FALLBACK.foreground
  const mode: 'light' | 'dark' =
    modeHint === 'light' || modeHint === 'dark' ? modeHint : luminance(background) >= 0.5 ? 'light' : 'dark'

  const values: Record<string, string> = {}
  for (const key of PALETTE_KEYS) {
    const value = pick(key)
    if (value) values[key] = value
  }
  values.background = background
  values.foreground = foreground
  values.accent ??= FALLBACK.accent
  values.muted ??= mix(foreground, background, 0.55)
  values.selection ??= mix(values.accent, background, 0.7)
  values.dark_background ??= mix(background, mode === 'dark' ? '#000000' : '#ffffff', 0.25)
  values.darker_background ??= mix(background, mode === 'dark' ? '#000000' : '#ffffff', 0.5)
  values.lighter_background ??= mix(background, foreground, 0.1)
  values.dark_foreground ??= mix(foreground, background, 0.4)
  values.light_foreground ??= mix(foreground, background, 0.15)
  values.bright_foreground ??= foreground
  for (const hue of ['red', 'yellow', 'orange', 'green', 'cyan', 'blue', 'magenta', 'brown']) {
    values[hue] ??= FALLBACK[hue]
  }

  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) vars[`--om-${key.replace(/_/g, '-')}`] = value

  /* Text on an accent fill: whichever of the theme's own ink or paper reads
     better, so a pale accent (kanagawa, kraken-depths) gets dark text. */
  vars['--om-on-accent'] = contrast(foreground, values.accent) >= contrast(background, values.accent) ? foreground : background
  vars['--om-urgent'] = values.red
  return { mode, vars }
}

const readText = async (file: string): Promise<string | null> => {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}

async function currentFont(): Promise<string> {
  if (await which('omarchy-font-current')) {
    const result = await run('omarchy-font-current', [], { timeoutMs: 3000 })
    const name = result.stdout.trim()
    if (result.code === 0 && name) return name
  }
  const result = await run('fc-match', ['-f', '%{family[0]}', 'monospace'], { timeoutMs: 3000 })
  return result.stdout.trim() || 'monospace'
}

/* Shape follows the compositor: Omarchy ships rounding 0, a theme or user
   config may raise it. */
async function currentRadius(): Promise<number> {
  if (!(await which('hyprctl'))) return 0
  const result = await run('hyprctl', ['getoption', 'decoration:rounding', '-j'], { timeoutMs: 2000 })
  try {
    const value = JSON.parse(result.stdout).int
    return typeof value === 'number' && value >= 0 && value <= 24 ? value : 0
  } catch {
    return 0
  }
}

export async function resolveTheme(): Promise<ThemePayload> {
  const [colorsText, nameText, font, radius] = await Promise.all([
    readText(COLORS_PATH),
    readText(THEME_NAME_PATH),
    currentFont(),
    currentRadius()
  ])
  const colors = colorsText ? parseColorsToml(colorsText) : {}
  let modeHint = colors.mode ?? colors.theme_type
  if (!modeHint) {
    try {
      await stat(path.join(THEME_DIR, 'light.mode'))
      modeHint = 'light'
    } catch {
      /* no marker */
    }
  }
  const { mode, vars } = buildPalette(colors, modeHint)
  return { name: nameText?.trim() || (colorsText ? 'omarchy' : 'default'), mode, vars, font, radius }
}

export function watchTheme(onChange: (theme: ThemePayload) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      resolveTheme().then(onChange).catch(() => {})
    }, 150)
  }
  let watcher: ReturnType<typeof watch> | undefined
  try {
    watcher = watch(CURRENT_DIR, { persistent: false }, schedule)
    watcher.on('error', () => {})
  } catch {
    return () => {}
  }
  return () => {
    if (timer) clearTimeout(timer)
    watcher?.close()
  }
}
