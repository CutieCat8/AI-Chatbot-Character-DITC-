import { Bell, Cat } from "lucide-react";
import { NavLink } from "react-router";

const NAV_ITEMS = [
  { label: "Knowledge Base", to: "/" },
  { label: "Chat Demo", to: "/chat" },
];

export function Navbar() {
  return (
    <nav className="h-12 bg-white border-b border-gray-100 flex items-center px-8 gap-8 sticky top-0 z-50 shrink-0">
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-6 h-6 rounded-md bg-gray-900 flex items-center justify-center">
          <Cat size={13} className="text-white" />
        </div>
        <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#111", letterSpacing: "-0.01em" }}>
          DITC CAT
        </span>
      </div>

      <div className="flex-1 flex items-center gap-0">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `px-3.5 py-1 rounded-md transition-colors ${
                isActive ? "text-gray-900" : "text-gray-400 hover:text-gray-700"
              }`
            }
            style={({ isActive }) => ({ fontSize: "0.82rem", fontWeight: isActive ? 600 : 400 })}
          >
            {item.label}
          </NavLink>
        ))}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <button className="text-gray-400 hover:text-gray-600 transition-colors relative">
          <Bell size={15} />
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-red-400 rounded-full" />
        </button>
        <div className="w-px h-4 bg-gray-200" />
        <div className="flex items-center gap-2 cursor-pointer group">
          <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
            <span style={{ fontSize: "0.6rem", fontWeight: 700, color: "#555" }}>TK</span>
          </div>
          <span className="text-gray-600 group-hover:text-gray-900 transition-colors" style={{ fontSize: "0.8rem" }}>
            ทีมงาน
          </span>
        </div>
      </div>
    </nav>
  );
}
