import { Cat } from "lucide-react";
import Orb from "./Orb/Orb";

const TRUST_BADGES = [
  { label: "RAG ready", className: "-top-3 left-1/2 -translate-x-1/2" },
  { label: "pgvector search", className: "top-1/2 -right-10 -translate-y-1/2" },
  { label: "PDPA compliant", className: "-bottom-3 -left-8" },
];

export function AuthShowcase() {
  return (
    <div className="relative hidden md:flex flex-col justify-between overflow-hidden bg-black">
      <div className="relative flex-1 flex items-center justify-center px-10">
        <div className="relative w-48 h-48">
          <div className="absolute -inset-20 rounded-full overflow-hidden opacity-70">
            <Orb hoverIntensity={0.4} rotateOnHover={false} hue={200} forceHoverState={false} />
          </div>
          <div className="absolute inset-0 rounded-full border border-dashed border-white/20 animate-[ditc-spin-cw_48s_linear_infinite]" />
          <div className="absolute inset-6 rounded-full border border-dashed border-white/20 animate-[ditc-spin-ccw_36s_linear_infinite]" />
          <div className="absolute inset-12 rounded-full border border-dashed border-white/25 animate-[ditc-spin-cw_24s_linear_infinite]" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-lg">
              <Cat size={22} className="text-gray-900" />
            </div>
          </div>
          {TRUST_BADGES.map((badge) => (
            <span
              key={badge.label}
              className={`absolute ${badge.className} bg-black/70 border border-white/15 text-white text-[10px] px-2 py-1 rounded-full whitespace-nowrap backdrop-blur`}
            >
              {badge.label}
            </span>
          ))}
        </div>
      </div>

      <div className="relative p-8 pt-0">
        <p className="text-white text-sm leading-relaxed">
          "An AI cat assistant that answers CAMT / DITC questions anytime, backed by a
          knowledge base kept in sync with the live site."
        </p>
        <p className="text-xs text-gray-500 mt-2">DITC CAT team</p>
      </div>
    </div>
  );
}
