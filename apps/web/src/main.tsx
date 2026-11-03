import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { FixtureCapture } from "./dev/FixtureCapture.tsx"
import { Landing } from "./Landing.tsx"
import { navigate, usePath } from "./lib/router.ts"
import { teacherSecret } from "./lib/storage.ts"
import { SharePage } from "./SharePage.tsx"
import { Join } from "./student/Join.tsx"
import { StudentApp } from "./student/StudentApp.tsx"
import { AssignmentPage } from "./teacher/AssignmentPage.tsx"
import { NewAssignment } from "./teacher/NewAssignment.tsx"
import { TeacherHome } from "./teacher/TeacherHome.tsx"
import "./styles.css"

function App() {
  const path = usePath()
  if (path === "/join") return <Join />
  if (path === "/s") return <StudentApp />
  if (path === "/dev/fixtures") return <FixtureCapture />
  if (path.startsWith("/share/")) return <SharePage slug={path.slice("/share/".length)} />
  if (path === "/t/new") return <NewAssignment />
  if (path.startsWith("/t")) {
    const secret = teacherSecret.read()
    if (!secret) { navigate("/"); return null }
    // Keep the capability out of the address bar after it's been saved (it stays in the copyable link).
    if (window.location.hash.includes("k=")) window.history.replaceState(null, "", window.location.pathname)
    const match = path.match(/^\/t\/a\/([\w-]+)$/)
    return match ? <AssignmentPage secret={secret} id={match[1]!} /> : <TeacherHome secret={secret} />
  }
  return <Landing />
}

const root = document.getElementById("root")
if (root === null) throw new Error("missing #root")
createRoot(root).render(<StrictMode><App /></StrictMode>)
