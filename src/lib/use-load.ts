import { useCallback, useEffect, useRef, useState } from 'react'

export type Loaded<T> = {
  data: T | null
  error: string | null
  loading: boolean
  reload: (force?: boolean) => void
}

/* Keeps the last good data on screen while a reload runs (the view dims it
   instead of blanking), and drops responses that arrive after a newer
   request has started. */
export function useLoad<T>(load: (force: boolean) => Promise<T>, deps: unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const sequence = useRef(0)
  const loadRef = useRef(load)
  loadRef.current = load

  const reload = useCallback((force = false) => {
    const id = ++sequence.current
    setLoading(true)
    setError(null)
    loadRef.current(force).then(
      (value) => {
        if (id !== sequence.current) return
        setData(value)
        setLoading(false)
      },
      (failure: unknown) => {
        if (id !== sequence.current) return
        setError(failure instanceof Error ? failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(failure))
        setLoading(false)
      }
    )
  }, [])

  useEffect(() => {
    reload(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, loading, reload }
}
