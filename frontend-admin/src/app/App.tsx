import { Route, Routes } from "react-router";
import { Navbar } from "./components/Navbar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import KnowledgeBasePage from "./pages/KnowledgeBasePage";
import ChatPage from "./pages/ChatPage";

export default function App() {
  return (
    <div className="min-h-screen h-screen flex flex-col">
      <Navbar />
      <div className="flex-1 flex flex-col min-h-0 bg-gray-50">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<KnowledgeBasePage />} />
            <Route path="/chat" element={<ChatPage />} />
          </Routes>
        </ErrorBoundary>
      </div>
    </div>
  );
}
