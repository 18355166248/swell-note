import { createContext, useContext, type ReactNode } from "react"

const RouteActivityContext = createContext(true)

export function RouteActivityProvider({ active, children }: { active: boolean; children: ReactNode }) {
  return <RouteActivityContext.Provider value={active}>{children}</RouteActivityContext.Provider>
}

export function useRouteActivity() {
  return useContext(RouteActivityContext)
}
