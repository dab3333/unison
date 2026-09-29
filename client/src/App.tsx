import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import Dashboard from './pages/Dashboard'
import Join from './pages/Join'
import Landing from './pages/Landing'
import SignIn from './pages/SignIn'
import Terms from './pages/Terms'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/join/:slug" element={<Join />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
