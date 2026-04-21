import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcCallOptions, RpcEventMap, RpcMethodMap, RpcMethodName } from '@shared/rpc-types'
import { call, on } from '@/lib/rpc'

export interface RpcQueryState<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean
  refetch: () => Promise<void>
}

export function useRpcQuery<K extends RpcMethodName>(
  method: K,
  params: RpcMethodMap[K]['params'],
  opts?: RpcCallOptions & { enabled?: boolean; deps?: unknown[] }
): RpcQueryState<RpcMethodMap[K]['result']> {
  const [data, setData] = useState<RpcMethodMap[K]['result']>()
  const [error, setError] = useState<Error>()
  const [loading, setLoading] = useState(false)
  const enabled = opts?.enabled ?? true
  const depsKey = (opts?.deps ?? [JSON.stringify(params)]).join('')

  // Latest params/opts via ref so the effect key stays stable under depsKey.
  const paramsRef = useRef(params)
  const optsRef = useRef(opts)
  useEffect(() => {
    paramsRef.current = params
    optsRef.current = opts
  })

  const run = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const r = await call(method, paramsRef.current, optsRef.current)
      setData(r)
    } catch (e) {
      setError(e as Error)
    } finally {
      setLoading(false)
    }
  }, [method])

  useEffect(() => {
    // set-state-in-effect is inherent to data-fetching hooks
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (enabled) void run()
    // depsKey is a stable string derived from user-provided deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, method, depsKey])

  return { data, error, loading, refetch: run }
}

export interface RpcMutationState<P, R> {
  mutate: (params: P) => Promise<R>
  data: R | undefined
  error: Error | undefined
  loading: boolean
  reset: () => void
}

export function useRpcMutation<K extends RpcMethodName>(
  method: K,
  opts?: RpcCallOptions
): RpcMutationState<RpcMethodMap[K]['params'], RpcMethodMap[K]['result']> {
  const [data, setData] = useState<RpcMethodMap[K]['result']>()
  const [error, setError] = useState<Error>()
  const [loading, setLoading] = useState(false)

  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })

  const mutate = useCallback(
    async (params: RpcMethodMap[K]['params']): Promise<RpcMethodMap[K]['result']> => {
      setLoading(true)
      setError(undefined)
      try {
        const r = await call(method, params, optsRef.current)
        setData(r)
        return r
      } catch (e) {
        setError(e as Error)
        throw e
      } finally {
        setLoading(false)
      }
    },
    [method]
  )

  const reset = useCallback(() => {
    setData(undefined)
    setError(undefined)
    setLoading(false)
  }, [])

  return { mutate, data, error, loading, reset }
}

export function useRpcEvent<E extends keyof RpcEventMap>(
  event: E,
  cb: (payload: RpcEventMap[E]) => void
): void {
  const cbRef = useRef(cb)
  useEffect(() => {
    cbRef.current = cb
  })
  useEffect(() => {
    const unsubscribe = on(event, (payload) => cbRef.current(payload))
    return unsubscribe
  }, [event])
}
