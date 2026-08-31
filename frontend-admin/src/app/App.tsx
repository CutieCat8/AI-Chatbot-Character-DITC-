import { Route, Routes } from "react-router";
import { Navbar } from "./components/Navbar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ProtectedRoute } from "./components/ProtectedRoute";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import KnowledgeBasePage from "./pages/KnowledgeBasePage";
import ChatPage from "./pages/ChatPage";
import NotFoundPage from "./pages/NotFoundPage";

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route element={<ProtectedRoute />}>
          <Route
            path="/dashboard"
            element={
              <div className="min-h-screen h-screen flex flex-col">
                <Navbar />
                <div className="flex-1 flex flex-col min-h-0 bg-gray-50">
                  <KnowledgeBasePage />
                </div>
              </div>
            }
          />
          <Route
            path="/dashboard/chat"
            element={
              <div className="min-h-screen h-screen flex flex-col">
                <Navbar />
                <div className="flex-1 flex flex-col min-h-0 bg-gray-50">
                  <ChatPage />
                </div>
              </div>
            }
          />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ErrorBoundary>
  );
}
