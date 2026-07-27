import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import LandingPage from "./landingpage";
import AuthPage from "./auth/AuthPage";
import ProtectedRoute from "./auth/ProtectedRoute";
import { AuthProvider } from "./auth/AuthContext";

function protectedPage() {
  return (
    <ProtectedRoute>
      <LandingPage />
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<AuthPage />} />

          <Route path="/dashboard" element={protectedPage()} />
          <Route path="/command-center" element={<Navigate to="/dashboard" replace />} />

          <Route path="/inbox" element={protectedPage()} />
          <Route path="/calls" element={<Navigate to="/inbox" replace />} />
          <Route path="/whatsapp" element={<Navigate to="/inbox" replace />} />

          <Route path="/leads" element={protectedPage()} />
          <Route path="/customers" element={<Navigate to="/leads" replace />} />
          <Route path="/pipeline" element={<Navigate to="/leads" replace />} />
          <Route path="/handover" element={<Navigate to="/leads" replace />} />
          <Route path="/bookings" element={<Navigate to="/leads" replace />} />

          <Route path="/tasks" element={protectedPage()} />

          <Route path="/team" element={protectedPage()} />
          <Route path="/agents" element={<Navigate to="/team" replace />} />

          <Route path="/reports" element={protectedPage()} />
          <Route path="/analytics" element={<Navigate to="/reports" replace />} />

          <Route path="/settings" element={protectedPage()} />
          <Route path="/integrations" element={<Navigate to="/settings" replace />} />
          <Route path="/knowledge" element={<Navigate to="/settings" replace />} />
          <Route path="/outbox" element={<Navigate to="/settings" replace />} />

          <Route path="/ai-ceo" element={protectedPage()} />

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}