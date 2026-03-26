import { Link, useLocation } from "wouter";
import { Clock, Users, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Command", icon: LayoutDashboard },
  { href: "/profiles", label: "Agents", icon: Users },
];

export default function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="w-16 lg:w-56 flex flex-col border-r border-border bg-sidebar shrink-0 h-screen overflow-hidden">
      {/* Logo */}
      <div className="h-14 flex items-center px-3 lg:px-5 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          {/* SVG Logo */}
          <svg viewBox="0 0 28 28" width="28" height="28" aria-label="Shiftmaxxing logo" fill="none">
            <circle cx="14" cy="14" r="12" stroke="hsl(51 100% 50%)" strokeWidth="2"/>
            <circle cx="14" cy="14" r="3" fill="hsl(51 100% 50%)"/>
            <line x1="14" y1="14" x2="14" y2="5" stroke="hsl(51 100% 50%)" strokeWidth="2" strokeLinecap="round"/>
            <line x1="14" y1="14" x2="20" y2="17" stroke="hsl(0 0% 70%)" strokeWidth="1.5" strokeLinecap="round"/>
            {/* Tick marks */}
            <line x1="14" y1="2" x2="14" y2="4" stroke="hsl(51 100% 50%)" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="26" y1="14" x2="24" y2="14" stroke="hsl(51 100% 50%)" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="14" y1="26" x2="14" y2="24" stroke="hsl(51 100% 50%)" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="2" y1="14" x2="4" y2="14" stroke="hsl(51 100% 50%)" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span className="hidden lg:block text-sm font-semibold tracking-tight text-foreground">Shiftmaxxing</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-1 p-2 lg:p-3 pt-3">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 px-2.5 py-2 rounded-md text-sm font-medium transition-all duration-150 hover-elevate cursor-pointer",
              location === href
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
            data-testid={`nav-${label.toLowerCase()}`}
          >
            <Icon size={16} className="shrink-0" />
            <span className="hidden lg:block">{label}</span>
          </Link>
        ))}
      </nav>

      {/* UTC Clock */}
      <div className="p-3 border-t border-border">
        <LiveUTCClock />
      </div>
    </aside>
  );
}

function LiveUTCClock() {
  const [time, setTime] = React.useState(new Date());
  React.useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const utc = time.toUTCString().slice(17, 25);

  return (
    <div className="flex items-center gap-2">
      <div className="relative w-2 h-2 shrink-0">
        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
      </div>
      <div className="hidden lg:block">
        <p className="text-[10px] text-muted-foreground leading-none">UTC NOW</p>
        <p className="text-xs font-mono font-bold text-primary tabular-nums mt-0.5">{utc}</p>
      </div>
    </div>
  );
}

import React from "react";
