import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { AlignLeft, CalendarRange, CircleDot, Clock, Users, LayoutDashboard, Hand, ScrollText, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDragScrollPreference } from "@/hooks/use-drag-scroll";
import type { AgentSession } from "@/lib/agentAccess";

const navItems = [
  { href: "/", label: "Command", icon: LayoutDashboard },
  { href: "/activity", label: "Activity", icon: ScrollText },
  { href: "/overtime", label: "Overtime", icon: Clock },
  { href: "/profiles", label: "Agents", icon: Users },
];

const VIEW_ITEMS = [
  { mode: "clock" as const, scope: undefined, label: "Clock", icon: CircleDot },
  { mode: "timeline" as const, scope: "day" as const, label: "1 Day", icon: AlignLeft },
  { mode: "timeline" as const, scope: "multi" as const, label: "14 Days", icon: CalendarRange },
];

export default function Sidebar({
  agentSession,
  onAgentSignOff,
  isOnBreak,
}: {
  agentSession?: AgentSession | null;
  onAgentSignOff?: () => void;
  isOnBreak?: boolean;
}) {
  const [location] = useLocation();
  const { enabled: dragScrollEnabled, setEnabled: setDragScrollEnabled } = useDragScrollPreference();

  const [viewMode, setViewMode] = useState<"clock" | "timeline">(
    () => (localStorage.getItem("shiftclock:viewMode") as "clock" | "timeline") ?? "clock"
  );
  const [timelineScope, setTimelineScope] = useState<"day" | "multi">(
    () => (localStorage.getItem("shiftclock:timelineScope") as "day" | "multi") ?? "day"
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const { mode, scope } = (e as CustomEvent<{ mode: "clock" | "timeline"; scope?: "day" | "multi" }>).detail;
      setViewMode(mode);
      if (scope) setTimelineScope(scope);
    };
    window.addEventListener("shiftclock:viewchange", handler);
    return () => window.removeEventListener("shiftclock:viewchange", handler);
  }, []);

  const switchView = (mode: "clock" | "timeline", scope?: "day" | "multi") => {
    localStorage.setItem("shiftclock:viewMode", mode);
    if (scope) localStorage.setItem("shiftclock:timelineScope", scope);
    window.dispatchEvent(new CustomEvent("shiftclock:viewchange", { detail: { mode, scope } }));
  };

  return (
    <aside className="w-14 sm:w-16 lg:w-56 flex flex-col border-r border-border bg-sidebar shrink-0 h-screen overflow-hidden">
      {/* Logo */}
      <div className="h-14 flex items-center px-2.5 sm:px-3 lg:px-5 border-b border-border shrink-0">
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
          <React.Fragment key={href}>
            <Link
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
            {href === "/" && location === "/" && (
              <div className="flex flex-col gap-0.5 ml-1 lg:ml-2 pl-1 lg:pl-2 border-l border-border/50">
                {VIEW_ITEMS.map(({ mode, scope, label: vLabel, icon: VIcon }) => {
                  const isActive = mode === viewMode && (scope == null || scope === timelineScope);
                  return (
                    <button
                      key={vLabel}
                      onClick={() => switchView(mode, scope)}
                      className={cn(
                        "flex items-center gap-3 px-2 py-1.5 rounded-md text-xs font-medium transition-all duration-150 w-full text-left",
                        isActive
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      )}
                    >
                      <VIcon size={13} className="shrink-0" />
                      <span className="hidden lg:block">{vLabel}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </React.Fragment>
        ))}
      </nav>

      {/* Bottom area: agent indicator or UTC clock */}
      <div className="p-2 sm:p-3 border-t border-border space-y-2">
        <button
          onClick={() => setDragScrollEnabled(!dragScrollEnabled)}
          className={cn(
            "w-full flex items-center gap-2 rounded-md border px-2 py-1.5 text-[10px] transition-colors",
            dragScrollEnabled
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          )}
          data-testid="toggle-drag-scroll"
        >
          <Hand size={11} />
          <span className="hidden lg:inline">Drag scroll</span>
          <span className="ml-auto font-mono">{dragScrollEnabled ? "ON" : "OFF"}</span>
        </button>

        {agentSession ? (
          <AgentIndicator session={agentSession} onSignOff={onAgentSignOff} isOnBreak={isOnBreak} />
        ) : (
          <LiveUTCClock />
        )}
      </div>
    </aside>
  );
}

function AgentIndicator({ session, onSignOff, isOnBreak }: { session: AgentSession; onSignOff?: () => void; isOnBreak?: boolean }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="relative w-2 h-2 shrink-0">
        <div className={cn("w-2 h-2 rounded-full animate-pulse", isOnBreak ? "bg-amber-400" : "bg-blue-400")} />
        {isOnBreak && <span className="absolute -top-1.5 -right-1.5 text-[8px]">☕</span>}
      </div>
      <div className="hidden lg:flex flex-1 items-center justify-between min-w-0 gap-1">
        <div className="min-w-0">
          <p className={cn("text-[10px] leading-none font-semibold truncate", isOnBreak ? "text-amber-400" : "text-blue-400")}>
            {isOnBreak ? "ON BREAK" : "AGENT SESSION"}
          </p>
          <p className="text-xs font-medium text-foreground truncate mt-0.5">{session.agentName}</p>
        </div>
      </div>
      {onSignOff && (
        <button
          onClick={onSignOff}
          title="Sign off"
          className="shrink-0 p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
        >
          <LogOut size={11} />
        </button>
      )}
    </div>
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
