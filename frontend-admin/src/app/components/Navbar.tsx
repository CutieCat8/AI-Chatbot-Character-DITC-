import { Bell, LogOut } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { clearToken } from "../../lib/api";
import logo from "../../assets/logo.png";

const NAV_ITEMS = [
  { label: "Knowledge Base", to: "/dashboard" },
  { label: "Chat Demo", to: "/dashboard/chat" },
];

export function Navbar() {
  const navigate = useNavigate();

  function handleLogout() {
    clearToken();
    navigate("/login");
  }

  return (
    <nav className="h-12 bg-white border-b border-gray-100 flex items-center px-8 gap-8 sticky top-0 z-50 shrink-0">
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-6 h-6 rounded-md bg-white border border-gray-200 flex items-center justify-center overflow-hidden">
          <img src={logo} alt="DITC CAT" className="w-full h-full object-contain p-0.5" />
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
            end={item.to === "/dashboard"}
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
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 text-gray-400 hover:text-gray-700 transition-colors"
          style={{ fontSize: "0.8rem" }}
        >
          <LogOut size={13} />
          ออกจากระบบ
        </button>
      </div>
    </nav>
  );
}
