import type { CleanCategoryId } from '../../src-electron/types'
import type { AppApi } from '../lib/app-context'
import { bytes } from '../lib/format'
import { G } from '../lib/glyphs'

/* Shared by the overview's "fix" and the clean view: one confirmation that
   says exactly what will go and whether a password prompt follows, then one
   batched run, then a toast with the measured (not estimated) result. */
export async function runClean(app: AppApi, ids: CleanCategoryId[]): Promise<boolean> {
  if (ids.length === 0) return false
  const categories = (await app.bridge.cleanList()).filter((category) => ids.includes(category.id) && category.available)
  if (categories.length === 0) return false
  const total = categories.reduce((sum, category) => sum + (category.bytes ?? 0), 0)
  const privileged = categories.filter((category) => category.privileged)
  const review = categories.some((category) => category.risk === 'review')

  const confirmed = await app.confirm({
    title: `Clean ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}?`,
    glyph: G.clean,
    danger: review,
    confirmLabel: `Clean ${bytes(total)}`,
    body: (
      <>
        <div style={{ marginBottom: 8 }}>
          {categories.map((category) => (
            <div className="row" key={category.id} style={{ minHeight: 22, padding: 0 }}>
              <span className="label">{category.label}</span>
              <span className="trail">{bytes(category.bytes)}</span>
            </div>
          ))}
        </div>
        {privileged.length > 0 && (
          <div className="dim">
            {privileged.map((category) => category.label).join(', ')} need{privileged.length === 1 ? 's' : ''} root: you will be asked for your password once.
          </div>
        )}
      </>
    )
  })
  if (!confirmed) return false

  app.setStatus('Cleaning…')
  try {
    const results = await app.bridge.cleanRun(categories.map((category) => category.id))
    const freed = results.reduce((sum, result) => sum + result.freedBytes, 0)
    const failed = results.filter((result) => !result.ok)
    if (failed.length === 0) {
      app.toast(`Freed ${bytes(freed)}`, results.map((result) => result.message).filter(Boolean).join(' · '))
    } else {
      app.toast(`Freed ${bytes(freed)}, ${failed.length} failed`, failed.map((result) => `${result.id}: ${result.message}`).join(' · '), 'urgent')
    }
    app.setStatus(`Cleaned ${results.length - failed.length}/${results.length} · freed ${bytes(freed)}`)
    return true
  } catch (error) {
    app.toast('Cleaning failed', error instanceof Error ? error.message : String(error), 'urgent')
    app.setStatus('Cleaning failed')
    return false
  }
}
