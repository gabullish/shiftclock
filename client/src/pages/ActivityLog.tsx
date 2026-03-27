import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Agent, AgentLog, OvertimeLog } from "@shared/schema";
import { cn } from "@/lib/utils";
import { ScrollText, Clock, CheckCircle, XCircle, DollarSign, ArrowRightLeft, ExternalLink, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAdminMode } from "@/hooks/use-admin-mode";

const TABS = ["Activity Log", "Overtime"] as const;
type Tab = (typeof TABS)[number];

export default function ActivityLog() {
  const isAdmin = useAdminMode();
  const availableTabs = isAdmin ? TABS : (["Overtime"] as const);
  const [tab, setTab] = useState<Tab>(isAdmin ? "Activity Log" : "Overtime");

  useEffect(() => {
    if (!isAdmin) setTab("Overtime");
  }, [isAdmin]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="h-14 flex items-center justify-between px-6 border-b border-border shrink-0 bg-card/50 backdrop-blur">
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
                tab === t
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "Activity Log" ? <ScrollText size={13} /> : <Clock size={13} />}
              {t}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "Activity Log" && isAdmin ? <ActivityFeed /> : <OvertimePanel canManage={isAdmin} />}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Activity Feed — newest-first, terminal-style
   ────────────────────────────────────────────────────────────── */

function ActivityFeed() {
  const { data: logs = [] } = useQuery<AgentLog[]>({ queryKey: ["/api/agent-logs"] });
  const { data: agents = [] } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });

  const agentMap = new Map(agents.map((a) => [a.id, a]));

  const sorted = [...logs]
    .filter((l) => l.description)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="h-full overflow-y-auto overscroll-contain p-4">
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <ScrollText size={32} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No activity yet.</p>
          <p className="text-xs text-muted-foreground">
            Actions like shift changes, overtime assignments, and status updates will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-1 max-w-3xl mx-auto font-mono text-[12px]">
          {sorted.map((log) => {
            const agent = agentMap.get(log.agentId);
            const ts = formatLogTimestamp(log.createdAt);
            return (
              <div
                key={log.id}
                className="flex gap-3 py-1.5 px-2 rounded hover:bg-muted/50 transition-colors"
              >
                <span className="text-muted-foreground shrink-0 tabular-nums">{ts}</span>
                <span className="text-[10px] shrink-0 mt-0.5">
                  {log.actionType && (
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0"
                      style={{
                        borderColor: agent ? agent.color + "50" : undefined,
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

/* ──────────────────────────────────────────────────────────────
   Overtime Panel — grouped list with status badges
   ────────────────────────────────────────────────────────────── */

const STATUS_CONFIG = {
  pending: { label: "Pending", color: "text-yellow-400", bg: "bg-yellow-500/15 border-yellow-500/30", icon: Clock },
  approved: { label: "Approved", color: "text-blue-400", bg: "bg-blue-500/15 border-blue-500/30", icon: CheckCircle },
  denied: { label: "Denied", color: "text-red-400", bg: "bg-red-500/15 border-red-500/30", icon: XCircle },
  paid: { label: "Paid", color: "text-green-400", bg: "bg-green-500/15 border-green-500/30", icon: DollarSign },
} as const;

const ALL_STATUSES = ["pending", "approved", "paid", "denied"] as const;

function StatusDropdown({ current, onSelect }: { current: string; onSelect: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const status = current as keyof typeof STATUS_CONFIG;
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const StatusIcon = cfg.icon;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-medium transition-all hover:scale-105 cursor-pointer",
          cfg.bg, cfg.color
        )}
      >
        <StatusIcon size={11} />
        {cfg.label}
        <ChevronDown size={9} className="ml-0.5 opacity-60" />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 right-0 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[120px]">
          {ALL_STATUSES.map((s) => {
            const c = STATUS_CONFIG[s];
            const Icon = c.icon;
            const isActive = s === status;
            return (
              <button
                key={s}
                onClick={() => { if (!isActive) onSelect(s); setOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-medium transition-colors text-left",
                  isActive ? "bg-muted/60 opacity-60 cursor-default" : "hover:bg-muted/40 cursor-pointer",
                  c.color,
                )}
              >
                <Icon size={12} />
                {c.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ current }: { current: string }) {
  const status = current as keyof typeof STATUS_CONFIG;
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const StatusIcon = cfg.icon;
  return (
    <div className={cn("inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-medium", cfg.bg, cfg.color)}>
      <StatusIcon size={11} />
      {cfg.label}
    </div>
  );
}

function OvertimePanel({ canManage }: { canManage: boolean }) {
  const { data: records = [] } = useQuery<OvertimeLog[]>({ queryKey: ["/api/overtime"] });
  const { data: agents = [] } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });

  const agentMap = new Map(agents.map((a) => [a.id, a]));

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/overtime/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overtime"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
    },
  });

  const sorted = [...records].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const hasRecords = sorted.length > 0;

  const navigateToTimeline = (rec: OvertimeLog) => {
    // Navigate to Dashboard timeline at the right day-of-week
    const d = new Date(rec.date + "T00:00:00Z");
    const dow = d.getUTCDay();
    // wouter uses hash-based routing; put query params in the regular URL
    // and navigate to the hash root
    window.location.href = `${window.location.pathname}?day=${dow}&scope=day#/`;
  };

  return (
    <div className="h-full overflow-y-auto overscroll-contain p-4">
      {!hasRecords ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <Clock size={32} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No overtime records yet.</p>
          <p className="text-xs text-muted-foreground">
            Overtime from shift extensions and claimed segments will appear here for review.
          </p>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto space-y-2">
          {/* Summary bar */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            {ALL_STATUSES.map((s) => {
              const count = sorted.filter((r) => (r.status ?? "pending") === s).length;
              const cfg = STATUS_CONFIG[s];
              return (
                <div
                  key={s}
                  className={cn("rounded-md border p-2.5 text-center", cfg.bg)}
                >
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                    {cfg.label}
                  </p>
                  <p className={cn("text-lg font-bold font-mono", cfg.color)}>{count}</p>
                </div>
              );
            })}
          </div>

          {/* Table */}
          <div className="rounded-lg border border-border overflow-visible">
            <div className="grid grid-cols-[1fr_100px_80px_140px_110px] gap-2 px-3 py-2 border-b border-border bg-muted/30 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              <span>Agent</span>
              <span>Date</span>
              <span>Hours</span>
              <span>Origin</span>
              <span>Status</span>
            </div>
            {sorted.map((rec) => {
              const agent = agentMap.get(rec.agentId);
              const status = (rec.status ?? "pending") as keyof typeof STATUS_CONFIG;
              const isDenied = status === "denied";
              const coveredBy = rec.coveredByAgentId ? agentMap.get(rec.coveredByAgentId) : null;

              return (
                <div
                  key={rec.id}
                  className={cn(
                    "grid grid-cols-[1fr_100px_80px_140px_110px] gap-2 px-3 py-2.5 border-b border-border last:border-b-0 items-center text-xs transition-opacity",
                    isDenied && "opacity-40"
                  )}
                >
                  {/* Agent */}
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: agent?.color }}
                    />
                    <span className="font-medium truncate">{agent?.name ?? "Unknown"}</span>
                  </div>

                  {/* Date */}
                  <span className="font-mono text-muted-foreground">{rec.date}</span>

                  {/* Hours */}
                  <span className="font-mono font-bold">
                    {rec.overtimeHours > 0 ? `+${rec.overtimeHours.toFixed(1)}h` : `${rec.releasedHours.toFixed(1)}h`}
                  </span>

                  {/* Origin — clickable when claimed-from-agent */}
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    {rec.origin === "claimed-from-agent" ? (
                      <button
                        onClick={() => navigateToTimeline(rec)}
                        className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
                        title="View on timeline"
                      >
                        <ArrowRightLeft size={10} />
                        <span>from <span style={{ color: coveredBy?.color }}>{coveredBy?.name ?? "agent"}</span></span>
                        <ExternalLink size={9} className="opacity-50" />
                      </button>
                    ) : (
                      <span>{rec.origin ?? "manager"}</span>
                    )}
                  </div>

                  {/* Status control: admins can update, view-only sees final manager decision */}
                  {canManage ? (
                    <StatusDropdown
                      current={status}
                      onSelect={(s) => statusMutation.mutate({ id: rec.id, status: s })}
                    />
                  ) : (
                    <StatusBadge current={status} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────── */

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
