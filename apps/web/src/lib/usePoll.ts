import { useEffect, useRef } from "react"

/**
 * Polls while `active`, backing off from `min` to `max` ms (D-24). Stops when
 * the tab is hidden so idle Chromebooks don't keep the server (or Neon) awake.
 */
export const usePoll = (tick: () => Promise<void>, active: boolean, min = 2_000, max = 8_000) => {
  const tickRef = useRef(tick)
  tickRef.current = tick
  useEffect(() => {
    if (!active) return
    let delay = min
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const loop = async () => {
      if (stopped) return
      if (document.visibilityState === "visible") await tickRef.current()
      delay = Math.min(max, Math.round(delay * 1.5))
      timer = setTimeout(loop, delay)
    }
    timer = setTimeout(loop, delay)
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [active, min, max])
}
