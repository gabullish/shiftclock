import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Agent, OvertimeClaim, OvertimeLog } from "@shared/schema";
import type { AgentSession } from "@/lib/agentAccess";
import { cn } from "@/lib/utils";
import {
  ArrowRightLeft,
  CheckCircle,
  ChevronDown,
  Clock,
  DollarSign,
  Download,
  MoreHorizontal,
  Trash2,
  Undo2,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { formatUtcHour, isCoverageClaim } from "@/lib/shiftUtils";
import { agentAuthHeaders } from "@/lib/agentAccess";

const STATUS_CONFIG = {
  pending: { label: "Pending", color: "text-yellow-400", bg: "bg-yellow-500/15 border-yellow-500/30", icon: Clock },
  approved: { label: "Approved", color: "text-blue-400", bg: "bg-blue-500/15 border-blue-500/30", icon: CheckCircle },
  denied: { label: "Denied", color: "text-red-400", bg: "bg-red-500/15 border-red-500/30", icon: XCircle },
  paid: { label: "Paid", color: "text-green-400", bg: "bg-green-500/15 border-green-500/30", icon: DollarSign },
} as const;

const ALL_STATUSES = ["pending", "approved", "paid", "denied"] as const;

export function OvertimePanel({
  canManage,
  agentSession,
}: {
  canManage: boolean;
  agentSession: AgentSession | null;
}) {
  const [location] = useLocation();
  const { data: records = [] } = useQuery<OvertimeLog[]>({ queryKey: ["/api/overtime"] });
  const { data: agents = [] } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });

  const sorted = useMemo(() => {
    const statusPriority: Record<string, number> = { pending: 0, approved: 1, paid: 2, denied: 3 };
    return [...records].sort((a, b) => {
      const pa = statusPriority[a.status ?? "pending"] ?? 99;
      const pb = statusPriority[b.status ?? "pending"] ?? 99;
      if (pa !== pb) return pa - pb;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [records]);

  const opportunityIds = useMemo(
    () => sorted.filter((r) => r.status === "pending" && isCoverageClaim(r)).map((r) => r.id),
    [sorted],
  );

  const { data: allClaims = [] } = useQuery<OvertimeClaim[]>({
    queryKey: ["/api/overtime-claims", opportunityIds.join(",")],
    queryFn: async () => {
      if (opportunityIds.length === 0) return [];
      const responses = await Promise.all(
        opportunityIds.map(async (id) => {
          const res = await fetch(`/api/overtime/${id}/claims`);
          if (!res.ok) return [] as OvertimeClaim[];
          return (await res.json()) as OvertimeClaim[];
        }),
      );
      return responses.flat();
    },
    enabled: opportunityIds.length > 0,
  });

  const claimsByOpportunity = useMemo(() => {
    const map = new Map<number, OvertimeClaim[]>();
    for (const c of allClaims) {
      const list = map.get(c.opportunityId) ?? [];
      list.push(c);
      map.set(c.opportunityId, list);
    }
    map.forEach((claims, id) => {
      map.set(id, [...claims].sort((a, b) => a.claimOrder - b.claimOrder));
    });
    return map;
  }, [allClaims]);

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>();

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => apiRequest("PATCH", `/api/overtime/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overtime"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
    },
  });

  const claimMutation = useMutation({
    mutationFn: async (opportunityId: number) => {
      const res = await fetch(`/api/overtime/${opportunityId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...agentAuthHeaders() },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Claim failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overtime"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overtime-claims"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-logs"] });
      toast({ title: "Joined line", description: "Waiting for manager approval." });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({
        title: msg.toLowerCase().includes("already joined") ? "Already in line" : "Join line failed",
        description: msg,
        variant: "destructive",
      });
    },
  });

  const cancelClaimMutation = useMutation({
    mutationFn: async (opportunityId: number) => {
      const res = await fetch(`/api/overtime/${opportunityId}/claim`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...agentAuthHeaders() },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Cancel failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overtime-claims"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-logs"] });
      toast({ title: "Claim canceled" });
    },
    onError: (err) => {
      toast({
        title: "Cancel failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const approveClaimMutation = useMutation({
    mutationFn: ({ opportunityId, claimId }: { opportunityId: number; claimId: number }) =>
      apiRequest("POST", `/api/overtime/${opportunityId}/approve-claim/${claimId}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overtime"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overtime-claims"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: "Claim approved" });
    },
    onError: () => {
      toast({ title: "Approval failed", variant: "destructive" });
    },
  });

  const clearOvertimeMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/overtime/all", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overtime"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-logs"] });
      setConfirmClear(false);
      toast({ title: "Overtime log cleared" });
    },
  });

  const importOvertimeMutation = useMutation({
    mutationFn: (payload: { records: OvertimeLog[] }) => apiRequest("POST", "/api/overtime/import", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/overtime"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: "Overtime records imported" });
    },
    onError: () => {
      toast({ title: "Import failed", description: "Check the JSON format.", variant: "destructive" });
    },
  });

  const handleExportOT = () => {
    const data = JSON.stringify(sorted, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `overtime-log-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmClear(false), 3500);
      return;
    }
    clearTimeout(confirmTimer.current);
    clearOvertimeMutation.mutate();
  };

  const handleImportOT = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        throw new Error("records array required");
      }
      importOvertimeMutation.mutate({ records: parsed as OvertimeLog[] });
    } catch {
      toast({ title: "Import failed", description: "Invalid JSON file.", variant: "destructive" });
    } finally {
      if (importFileRef.current) importFileRef.current.value = "";
    }
  };

  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [focusedOtId, setFocusedOtId] = useState<number | null>(null);
  const [activeJoinId, setActiveJoinId] = useState<number | null>(null);
  const [activeUndoId, setActiveUndoId] = useState<number | null>(null);

  const handleJoinLine = async (opportunityId: number) => {
    if (activeJoinId != null) return;
    setActiveJoinId(opportunityId);
    try {
      await claimMutation.mutateAsync(opportunityId);
    } finally {
      setActiveJoinId(null);
    }
  };

  const handleUndoLine = async (opportunityId: number) => {
    if (activeUndoId != null) return;
    setActiveUndoId(opportunityId);
    try {
      await cancelClaimMutation.mutateAsync(opportunityId);
    } finally {
      setActiveUndoId(null);
    }
  };

  useEffect(() => {
    const hashQuery = location.split("?")[1] || "";
    const searchQuery = window.location.search.startsWith("?") ? window.location.search.slice(1) : "";
    const params = new URLSearchParams(hashQuery || searchQuery);
    const raw = params.get("otId");
    if (!raw) {
      setFocusedOtId(null);
      return;
    }
    const parsed = Number(raw);
    setFocusedOtId(Number.isFinite(parsed) ? parsed : null);
  }, [location]);

  useEffect(() => {
    if (focusedOtId == null) return;
    const target = rowRefs.current[focusedOtId];
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusedOtId, sorted]);

  const navigateToTimeline = (rec: OvertimeLog) => {
    const d = new Date(`${rec.date}T00:00:00Z`);
    const dow = d.getUTCDay();
    const focusHour = rec.coverStartUtc ?? 0;
    const params = new URLSearchParams();
    params.set("day", String(dow));
    params.set("date", rec.date);
    params.set("scope", "multi");
    params.set("focusHour", String(focusHour));
    params.set("focusAgentId", String(rec.agentId));
    window.location.href = `${window.location.pathname}?${params.toString()}#/`;
  };

  return (
    <div className="h-full overflow-y-auto overscroll-contain p-4">
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <Clock size={32} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No overtime records yet.</p>
        </div>
      ) : (
        <div className="max-w-5xl mx-auto space-y-2">
          <div className="flex flex-wrap justify-end mb-1 gap-2">
            <input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportOT} />
            <button
              onClick={handleExportOT}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Download size={11} /> Export
            </button>
            {canManage && (
              <button
                onClick={() => importFileRef.current?.click()}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Upload size={11} /> Import
              </button>
            )}
            {canManage && (
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

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {ALL_STATUSES.map((s) => {
              const count = sorted.filter((r) => (r.status ?? "pending") === s).length;
              const cfg = STATUS_CONFIG[s];
              return (
                <div key={s} className={cn("rounded-md border p-2.5 text-center", cfg.bg)}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{cfg.label}</p>
                  <p className={cn("text-lg font-bold font-mono", cfg.color)}>{count}</p>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-border overflow-x-auto">
            <div className="min-w-[760px]">
            <div className="grid grid-cols-[1fr_95px_72px_1fr_160px] gap-2 px-3 py-2 border-b border-border bg-muted/30 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              <span>Opportunity</span>
              <span>Date</span>
              <span>Hours</span>
              <span>Origin</span>
              <span>Status / Claims</span>
            </div>

            {sorted.map((rec) => {
              const agent = agentMap.get(rec.agentId);
              const status = (rec.status ?? "pending") as keyof typeof STATUS_CONFIG;
              const isDenied = status === "denied";
              const coveredBy = rec.coveredByAgentId ? agentMap.get(rec.coveredByAgentId) : null;
              const recClaims = claimsByOpportunity.get(rec.id) ?? [];
              const pendingClaims = recClaims.filter((c) => c.status === "pending");
              const myPendingClaim = agentSession ? pendingClaims.find((c) => c.agentId === agentSession.agentId) : null;
              const isOpportunity = isCoverageClaim(rec) && rec.status === "pending";

              return (
                <div
                  key={rec.id}
                  ref={(el) => {
                    rowRefs.current[rec.id] = el;
                  }}
                  className={cn(
                    "border-b border-border last:border-b-0 transition-opacity",
                    isDenied && "opacity-40",
                    focusedOtId === rec.id && "ring-1 ring-primary/60 bg-primary/5",
                  )}
                >
                  <div className="grid grid-cols-[1fr_95px_72px_1fr_160px] gap-2 px-3 py-2.5 items-center text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: agent?.color ?? "#888" }} />
                      <span className="font-medium truncate">{agent?.name ?? "Unknown"}</span>
                      {pendingClaims.length > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] text-yellow-400 font-semibold shrink-0">
                          <Users size={10} /> {pendingClaims.length}
                        </span>
                      )}
                    </div>

                    <span className="font-mono text-muted-foreground">{rec.date}</span>

                    <span className="font-mono font-bold">
                      {rec.overtimeHours > 0 ? `+${rec.overtimeHours.toFixed(1)}h` : `${rec.releasedHours.toFixed(1)}h`}
                    </span>

                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground min-w-0">
                      {isCoverageClaim(rec) ? (
                        <button
                          onClick={() => navigateToTimeline(rec)}
                          className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer truncate"
                          title="View on timeline"
                        >
                          <ArrowRightLeft size={10} className="shrink-0" />
                          <span className="truncate">
                            {rec.origin === "claimed-open-gap"
                              ? `gap ${rec.coverStartUtc != null && rec.coverEndUtc != null ? `${formatUtcHour(rec.coverStartUtc)}-${formatUtcHour(rec.coverEndUtc)}` : ""}`
                              : `from ${coveredBy?.name ?? "agent"}`}
                          </span>
                        </button>
                      ) : (
                        <span className="truncate">{rec.origin ?? "manager"}</span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 justify-end">
                      {agentSession && isOpportunity && !canManage && (
                        myPendingClaim ? (
                          <button
                            onClick={() => void handleUndoLine(rec.id)}
                            disabled={activeUndoId === rec.id || cancelClaimMutation.isPending}
                            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
                            title="Cancel your claim"
                          >
                            <Undo2 size={10} /> {activeUndoId === rec.id ? "Undoing…" : "Undo"}
                          </button>
                        ) : (
                          <button
                            onClick={() => void handleJoinLine(rec.id)}
                            disabled={activeJoinId === rec.id || claimMutation.isPending}
                            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {activeJoinId === rec.id ? "Joining…" : "Join line"}
                          </button>
                        )
                      )}

                      {canManage && pendingClaims.length > 0 && isOpportunity && (
                        <ClaimApproverDropdown
                          claims={pendingClaims}
                          agentMap={agentMap}
                          onApprove={(claimId) => approveClaimMutation.mutate({ opportunityId: rec.id, claimId })}
                        />
                      )}

                      {canManage ? (
                        <StatusDropdown
                          current={status}
                          onSelect={(s) => statusMutation.mutate({ id: rec.id, status: s })}
                        />
                      ) : (
                        <StatusBadge current={status} />
                      )}
                    </div>
                  </div>

                  {recClaims.length > 0 && (
                    <div className="px-4 pb-2 space-y-1">
                      {recClaims.map((claim) => {
                        const claimAgent = agentMap.get(claim.agentId);
                        const isMe = agentSession?.agentId === claim.agentId;
                        return (
                          <div
                            key={claim.id}
                            className={cn(
                              "flex items-center gap-2 text-[10px] py-0.5 px-2 rounded",
                              claim.status === "approved" && "bg-blue-500/10 text-blue-400",
                              claim.status === "pending" && "text-muted-foreground",
                              claim.status === "rejected" && "text-muted-foreground/40 line-through",
                              claim.status === "cancelled" && "text-muted-foreground/30 line-through",
                              isMe && claim.status === "pending" && "text-yellow-400",
                            )}
                          >
                            <span className="font-mono w-7 text-center opacity-60">#{claim.claimOrder}</span>
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: claimAgent?.color }} />
                            <span className="font-medium">{claimAgent?.name ?? `Agent #${claim.agentId}`}</span>
                            {isMe && <span className="text-[9px] opacity-60">(you)</span>}
                            <span className="ml-auto capitalize opacity-70">{claim.status}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusDropdown({ current, onSelect }: { current: string; onSelect: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const status = current as keyof typeof STATUS_CONFIG;
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const StatusIcon = cfg.icon;

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen(v => !v);
  };

  // Close on outside click — must check both the trigger wrapper AND the portal dropdown
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = ref.current?.contains(target);
      const inDrop = dropRef.current?.contains(target);
      if (!inTrigger && !inDrop) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on scroll or resize (position would go stale)
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        ref={btnRef}
        onClick={handleOpen}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-medium transition-all hover:scale-105 cursor-pointer",
          cfg.bg,
          cfg.color,
        )}
      >
        <StatusIcon size={11} />
        {cfg.label}
        <ChevronDown size={9} className="ml-0.5 opacity-60" />
      </button>
      {open && dropPos && createPortal(
        <div
          ref={dropRef}
          style={{ top: dropPos.top, right: dropPos.right }}
          className="fixed z-50 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[120px]"
        >
          {ALL_STATUSES.map((s) => {
            const c = STATUS_CONFIG[s];
            const Icon = c.icon;
            const isActive = s === status;
            return (
              <button
                key={s}
                onClick={() => {
                  if (!isActive) onSelect(s);
                  setOpen(false);
                }}
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
        </div>,
        document.body
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

function ClaimApproverDropdown({
  claims,
  agentMap,
  onApprove,
}: {
  claims: OvertimeClaim[];
  agentMap: Map<number, Agent>;
  onApprove: (claimId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        onClick={() => setOpen((v) => !v)}
        className="h-7 w-7 inline-flex items-center justify-center rounded border border-border hover:bg-muted/60 text-muted-foreground hover:text-foreground"
        title="Choose claim to approve"
      >
        <MoreHorizontal size={13} />
      </button>
      {open && (
        <div className="absolute z-50 right-0 top-full mt-1 w-56 rounded-md border border-border bg-card shadow-xl p-1">
          {claims.map((claim) => {
            const claimant = agentMap.get(claim.agentId);
            return (
              <button
                key={claim.id}
                onClick={() => {
                  onApprove(claim.id);
                  setOpen(false);
                }}
                className="w-full text-left rounded px-2 py-1.5 hover:bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] opacity-70 w-7">#{claim.claimOrder}</span>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: claimant?.color ?? "#888" }} />
                  <span className="text-xs font-medium truncate">{claimant?.name ?? `Agent #${claim.agentId}`}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
