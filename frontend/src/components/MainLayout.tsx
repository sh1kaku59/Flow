import type { ReactNode } from "react"
import Header from "./Header"

type MainLayoutProps = {
  children: ReactNode
}

function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="app-layout">
      <Header />

      <main className="app-content">
        {children}
      </main>
    </div>
  )
}

export default MainLayout
