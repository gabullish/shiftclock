import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Clock, ScrollText } from "lucide-react";
import { useAdminMode } from "@/hooks/use-admin-mode";
import { useAgentSession } from "@/hooks/use-agent-session";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { OvertimePanel } from "@/components/activity/OvertimePanel";

const TABS = ["Activity Log", "Overtime"] as const;
type Tab = (typeof TABS)[number];

export default function ActivityLog() {
  const isAdmin = useAdminMode();
  const agentSession = useAgentSession();
  const isAgent = Boolean(agentSession);
  const [location] = useLocation();
  const pathOnly = location.split("?")[0];
  const isOvertimeRoute = pathOnly === "/overtime";
  const availableTabs = isAdmin ? TABS : (["Overtime"] as const);
  const [tab, setTab] = useState<Tab>(isAdmin && !isOvertimeRoute ? "Activity Log" : "Overtime");

  // Keep tab in sync with the URL whenever the route changes
  useEffect(() => {
    setTab(isAdmin && !isOvertimeRoute ? "Activity Log" : "Overtime");
  }, [isAdmin, isOvertimeRoute]);

  if (!isAdmin && !isAgent) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Sign in as manager or agent to access overtime.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4 lg:px-6 border-b border-border bg-card/50 backdrop-blur">
        <div className="flex items-center gap-3">
          <ScrollText size={16} className="text-primary" />
          <h1 className="text-sm font-semibold">Activity &amp; Overtime</h1>
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
          {availableTabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all",
                tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "Activity Log" ? <ScrollText size={13} /> : <Clock size={13} />}
              {t}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "Activity Log" && isAdmin ? (
          <ActivityFeed />
        ) : (
          <OvertimePanel canManage={isAdmin} agentSession={agentSession ?? null} />
        )}
      </div>
    </div>
  );
}
