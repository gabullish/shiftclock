import { useRef, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Agent, AgentLog } from "@shared/schema";
import { cn } from "@/lib/utils";
import { Download, ScrollText, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAdminMode } from "@/hooks/use-admin-mode";
import { toast } from "@/hooks/use-toast";

function formatLogTimestamp(iso: string) {
  const d = new Date(iso);
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  const h = d.getUTCHours();
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${month}/${day}/${year} ${h12}:${m} ${ampm} UTC`;
}

export function ActivityFeed() {
  const { data: logs = [] } = useQuery<AgentLog[]>({ queryKey: ["/api/agent-logs"] });
  const { data: agents = [] } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });

  const isAdmin = useAdminMode();
  const [confirmClear, setConfirmClear] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>();

  const clearLogMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/agent-logs", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent-logs"] });
      setConfirmClear(false);
      toast({ title: "Activity log cleared" });
    },
  });

  const sorted = useMemo(
    () =>
      [...logs]
        .filter((l) => l.description)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [logs],
  );

  const handleClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmClear(false), 3500);
      return;
    }
    clearTimeout(confirmTimer.current);
    clearLogMutation.mutate();
  };

  const handleExport = () => {
    const data = JSON.stringify(sorted, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-log-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const agentMap = new Map(agents.map((a) => [a.id, a]));

  return (
    <div className="h-full overflow-y-auto overscroll-contain p-3 sm:p-4">
      {sorted.length > 0 && (
        <div className="flex items-center justify-end gap-2 mb-3 max-w-3xl mx-auto">
          <button
            onClick={handleExport}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Download size={11} /> Export
          </button>
          {isAdmin && (
            <button
              onClick={handleClear}
              className={cn(
                "flex items-center gap-1 text-[10px] transition-colors",
                confirmClear ? "text-destructive font-semibold" : "text-muted-foreground hover:text-destructive",
              )}
            >
              <Trash2 size={11} />
              {confirmClear ? "Confirm clear?" : "Clear log"}
            </button>
          )}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <ScrollText size={32} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        </div>
      ) : (
        <div className="space-y-1 max-w-3xl mx-auto font-mono text-[12px]">
          {sorted.map((log) => {
            const agent = agentMap.get(log.agentId);
            return (
              <div key={log.id} className="flex gap-3 py-1.5 px-2 rounded hover:bg-muted/50 transition-colors">
                <span className="text-muted-foreground shrink-0 tabular-nums">{formatLogTimestamp(log.createdAt)}</span>
                <span className="text-[10px] shrink-0 mt-0.5">
                  {log.actionType && (
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0"
                      style={{
                        borderColor: agent ? `${agent.color}50` : undefined,
                        color: agent ? agent.color : undefined,
                      }}
                    >
                      {log.actionType}
                    </Badge>
                  )}
                </span>
                <span className="text-foreground">{log.description}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
