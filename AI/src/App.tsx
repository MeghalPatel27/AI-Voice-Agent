import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import LandingPage from "./landingpage";
import { AuthProvider } from "./auth/AuthContext";

function appPage() {
  return <LandingPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/dashboard" element={appPage()} />
          <Route
            path="/command-center"
            element={<Navigate to="/dashboard" replace />}
          />

          <Route path="/inbox" element={appPage()} />
          <Route
            path="/whatsapp"
            element={<Navigate to="/inbox" replace />}
          />

          <Route path="/calls" element={appPage()} />

          <Route path="/leads" element={appPage()} />
          <Route
            path="/customers"
            element={<Navigate to="/leads" replace />}
          />
          <Route
            path="/pipeline"
            element={<Navigate to="/leads" replace />}
          />
          <Route
            path="/handover"
            element={<Navigate to="/leads" replace />}
          />

          <Route path="/bookings" element={appPage()} />
          <Route
            path="/meetings"
            element={<Navigate to="/bookings" replace />}
          />

          <Route path="/tasks" element={appPage()} />

          <Route path="/team" element={appPage()} />
          <Route
            path="/agents"
            element={<Navigate to="/team" replace />}
          />

          <Route path="/reports" element={appPage()} />
          <Route
            path="/analytics"
            element={<Navigate to="/reports" replace />}
          />

          <Route path="/settings" element={appPage()} />
          <Route
            path="/integrations"
            element={<Navigate to="/settings" replace />}
          />
          <Route
            path="/knowledge"
            element={<Navigate to="/settings" replace />}
          />
          <Route
            path="/outbox"
            element={<Navigate to="/settings" replace />}
          />

          <Route path="/ai-ceo" element={appPage()} />

          <Route
            path="/login"
            element={<Navigate to="/dashboard" replace />}
          />

          <Route
            path="/"
            element={<Navigate to="/dashboard" replace />}
          />

          <Route
            path="*"
            element={<Navigate to="/dashboard" replace />}
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}