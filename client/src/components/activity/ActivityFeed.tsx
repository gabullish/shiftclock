import { useRef, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Agent, AgentLog } from "@shared/schema";
import { cn } from "@/lib/utils";
import { Download, ScrollText, Trash2, Archive, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useAdminMode } from "@/hooks/use-admin-mode";
import { toast } from "@/hooks/use-toast";

const ARCHIVE_KEY = "activity-feed-archived-before";

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

type TimeRange = "1h" | "24h" | "7d" | "30d" | "all";

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  "1h":  "1h",
  "24h": "24h",
  "7d":  "7d",
  "30d": "30d",
  "all": "All",
};

function cutoffMs(range: TimeRange): number | null {
  const now = Date.now();
  if (range === "1h")  return now - 1 * 60 * 60 * 1000;
  if (range === "24h") return now - 24 * 60 * 60 * 1000;
  if (range === "7d")  return now - 7  * 24 * 60 * 60 * 1000;
  if (range === "30d") return now - 30 * 24 * 60 * 60 * 1000;
  return null; // all time
}

export function ActivityFeed() {
  const { data: logs = [] } = useQuery<AgentLog[]>({ queryKey: ["/api/agent-logs"] });
  const { data: agents = [] } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });

  const isAdmin = useAdminMode();
  const [confirmClear, setConfirmClear] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>();
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [showLibrary, setShowLibrary] = useState(false);

  // "archived-before" timestamp: entries created before this are hidden in the live feed
  const [archivedBefore, setArchivedBefore] = useState<number | null>(() => {
    const v = localStorage.getItem(ARCHIVE_KEY);
    return v ? parseInt(v, 10) : null;
  });

  const clearLogMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/agent-logs", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent-logs"] });
      setConfirmClear(false);
      toast({ title: "Activity log cleared" });
    },
    onError: (err) => {
      toast({
        title: "Couldn't clear activity log",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const allSorted = useMemo(
    () =>
      [...logs]
        .filter((l) => l.description)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [logs],
  );

  // Live feed: entries after the archive cutoff
  const liveSorted = useMemo(
    () => archivedBefore
      ? allSorted.filter(l => new Date(l.createdAt).getTime() > archivedBefore)
      : allSorted,
    [allSorted, archivedBefore],
  );

  // Apply time range filter to whichever set is being shown
  const sorted = useMemo(() => {
    const base = showLibrary ? allSorted : liveSorted;
    const cutoff = cutoffMs(timeRange);
    if (!cutoff) return base;
    return base.filter(l => new Date(l.createdAt).getTime() >= cutoff);
  }, [showLibrary, allSorted, liveSorted, timeRange]);

  const handleArchive = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmClear(false), 3500);
      return;
    }
    clearTimeout(confirmTimer.current);
    // Archive: mark current cutoff so entries are hidden from live feed, NOT deleted from DB
    const now = Date.now();
    setArchivedBefore(now);
    localStorage.setItem(ARCHIVE_KEY, String(now));
    setConfirmClear(false);
    toast({ title: "Feed archived", description: "All current entries moved to library. Data is preserved." });
  };

  const handleHardDelete = () => {
    setShowDeleteDialog(false);
    clearLogMutation.mutate();
    localStorage.removeItem(ARCHIVE_KEY);
    setArchivedBefore(null);
  };

  const handleExport = () => {
    const data = JSON.stringify(sorted, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const rangeLabel = timeRange === "all" ? "all" : timeRange;
    a.download = `activity-log-${rangeLabel}-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const agentMap = new Map(agents.map((a) => [a.id, a]));

  const archivedCount = archivedBefore
    ? allSorted.filter(l => new Date(l.createdAt).getTime() <= archivedBefore).length
    : 0;

  return (
    <div className="h-full overflow-y-auto overscroll-contain p-3 sm:p-4">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 max-w-3xl mx-auto">
        {/* Time range filter */}
        <div className="flex items-center gap-1">
          <Clock size={11} className="text-muted-foreground shrink-0" />
          {(Object.keys(TIME_RANGE_LABELS) as TimeRange[]).map(r => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded border transition-colors",
                timeRange === r
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
              )}
            >
              {TIME_RANGE_LABELS[r]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Library toggle */}
          {archivedCount > 0 && (
            <button
              onClick={() => setShowLibrary(v => !v)}
              className={cn(
                "flex items-center gap-1 text-[10px] transition-colors",
                showLibrary ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
              title={`${archivedCount} archived entries`}
            >
              <Archive size={11} />
              Library {archivedCount > 0 && <span className="opacity-60">({archivedCount})</span>}
            </button>
          )}

          {sorted.length > 0 && (
            <button
              onClick={handleExport}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Download size={11} /> Export
            </button>
          )}

          {isAdmin && (
            <button
              onClick={handleArchive}
              className={cn(
                "flex items-center gap-1 text-[10px] transition-colors",
                confirmClear ? "text-amber-400 font-semibold" : "text-muted-foreground hover:text-amber-400",
              )}
              title="Archive feed — entries are preserved in library, not deleted"
            >
              <Archive size={11} />
              {confirmClear ? "Confirm archive?" : "Archive feed"}
            </button>
          )}
          {isAdmin && archivedBefore && (
            <button
              onClick={() => setShowDeleteDialog(true)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive transition-colors"
              title="Permanently delete all logs including archived"
            >
              <Trash2 size={11} />
              Delete all
            </button>
          )}
        </div>
      </div>

      {showLibrary && archivedCount > 0 && (
        <div className="mb-3 max-w-3xl mx-auto px-2 py-1.5 rounded-md bg-amber-500/10 border border-amber-400/20 text-[10px] text-amber-300/80 flex items-center gap-1.5">
          <Archive size={10} />
          Showing library — {archivedCount} archived entries plus live feed
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <ScrollText size={32} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No activity for this time range.</p>
        </div>
      ) : (
        <div className="space-y-1 max-w-3xl mx-auto font-mono text-[12px]">
          {sorted.map((log) => {
            const agent = agentMap.get(log.agentId);
            const isArchived = archivedBefore && new Date(log.createdAt).getTime() <= archivedBefore;
            return (
              <div
                key={log.id}
                className={cn(
                  "flex gap-3 py-1.5 px-2 rounded hover:bg-muted/50 transition-colors",
                  isArchived && "opacity-50"
                )}
              >
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

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all activity logs?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the entire activity history — including archived
              entries — from the database for everyone.
              <br /><br />
              <strong>This action cannot be undone.</strong> To hide entries without
              deleting them, use “Archive feed” instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-2 justify-end">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleHardDelete} className="bg-destructive hover:bg-destructive/90">
              Delete all
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
