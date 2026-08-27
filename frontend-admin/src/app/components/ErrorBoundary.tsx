import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // เปิด DevTools Console (F12) จะเห็น stack trace เต็มตรงนี้ — เอาไปหาสาเหตุจริงต่อได้
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-24 text-center px-6">
          <AlertTriangle size={28} className="text-amber-400" />
          <p className="text-gray-700" style={{ fontSize: "0.9rem", fontWeight: 600 }}>
            หน้านี้เกิดข้อผิดพลาดไม่คาดคิด
          </p>
          <p className="text-gray-400 max-w-md" style={{ fontSize: "0.78rem" }}>
            {this.state.error.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-1 flex items-center gap-1.5 px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white rounded-lg transition-colors"
            style={{ fontSize: "0.8rem", fontWeight: 500 }}
          >
            <RefreshCw size={13} />
            รีโหลดหน้า
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
