import { useEffect, useState } from "react"

/** A ten-line router: the app has a handful of screens, not worth a dependency. */
export const navigate = (path: string) => {
  window.history.pushState(null, "", path)
  window.dispatchEvent(new PopStateEvent("popstate"))
}

export const usePath = () => {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])
  return path
}
