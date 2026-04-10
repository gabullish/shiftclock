import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Agent, Shift, InsertShift } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useSoothingSounds } from "@/hooks/use-soothing-sounds";
import { Plus, Pencil, Trash2, Clock, CalendarDays, Download, Upload, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminMode } from "@/hooks/use-admin-mode";
import { getEffectiveAdminToken } from "@/lib/adminAccess";
import { useAgentSession } from "@/hooks/use-agent-session";
import { AgentForm, AgentFormData, DEFAULT_COLORS } from "@/components/profiles/AgentForm";
import { ShiftPill } from "@/components/profiles/ShiftPill";
import { ApplyWeekRow } from "@/components/profiles/ApplyWeekRow";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getOffDays(offWeekend: number): number[] {
  return offWeekend === 1 ? [0, 6] : [4, 5];
}

function seedFromShifts(shifts: Shift[]): { start: number; end: number } {
  const s = shifts.find(sh => sh.startUtc != null && sh.endUtc != null);
  if (!s) return { start: 9, end: 17 };
  return {
    start: ((s.startUtc % 24) + 24) % 24,
    end:   ((s.endUtc   % 24) + 24) % 24,
  };
}

function getLocalTime(tz: string) {
  try {
    return new Date().toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "??:??";
  }
}

export default function Profiles() {
  const { toast } = useToast();
  const isAdmin = useAdminMode();
  const agentSession = useAgentSession();
  const { playSoftClick, playSuccess } = useSoothingSounds();
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const prevAgentRef = useRef<{ id: number; data: Partial<AgentFormData> } | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const { data: agents = [] } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });
  const { data: allShifts = [] } = useQuery<Shift[]>({ queryKey: ["/api/shifts"] });

  const createMutation = useMutation({
    mutationFn: (data: AgentFormData) => apiRequest("POST", "/api/agents", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      setShowCreate(false);
      toast({ title: "Agent created" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<AgentFormData> }) => {
      const current = agents.find(a => a.id === id);
      if (current) {
        prevAgentRef.current = {
          id,
          data: { name: current.name, color: current.color, timezone: current.timezone, role: current.role, avatarUrl: current.avatarUrl || "" },
        };
      }
      return apiRequest("PATCH", `/api/agents/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      setEditingAgent(null);
      const prev = prevAgentRef.current;
      toast({
        title: "Agent updated",
        description: prev ? "Click Undo to revert." : undefined,
        action: prev ? (
          <button
            onClick={() => updateMutation.mutate({ id: prev.id, data: prev.data })}
            className="text-xs underline underline-offset-2 shrink-0"
          >
            Undo
          </button>
        ) : undefined,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/agents/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      toast({ title: "Agent removed" });
    },
  });

  const upsertShiftMutation = useMutation({
    mutationFn: (data: InsertShift) => apiRequest("POST", "/api/shifts", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/shifts"] }),
  });

  const updateShiftMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<InsertShift> }) =>
      apiRequest("PATCH", `/api/shifts/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/shifts"] }),
  });

  const toggleOffDayMutation = useMutation({
    mutationFn: ({ id, offWeekend }: { id: number; offWeekend: number }) => {
      const today = new Date();
      const dayOfWeek = today.getUTCDay();
      const daysToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
      const monday = new Date(today);
      monday.setUTCDate(today.getUTCDate() + daysToMonday);
      const offCycleStart = monday.toISOString().split("T")[0];
      return apiRequest("PATCH", `/api/agents/${id}`, { offWeekend, offCycleStart });
    },
    onSuccess: (_, variables) => {
      setOffTogglePending(prev => new Set(prev).add(variables.id));
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      toast({ title: "Days off updated — click Apply to reassign shifts" });
    },
  });

  const [offTogglePending, setOffTogglePending] = useState<Set<number>>(new Set());

  const applyWeekMutation = useMutation({
    mutationFn: ({ id, startUtc, endUtc }: { id: number; startUtc: number; endUtc: number }) =>
      apiRequest("POST", `/api/agents/${id}/apply-week`, { startUtc, endUtc }),
    onSuccess: (_, variables) => {
      setOffTogglePending(prev => {
        const next = new Set(prev);
        next.delete(variables.id);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: "Week template applied" });
    },
  });

  const [dirtyAgentSettings, setDirtyAgentSettings] = useState<
    Record<number, { startH: number; endH: number }>
  >({});

  const handleAgentDirtyChange = (agentId: number, isDirty: boolean, startH: number, endH: number) => {
    setDirtyAgentSettings(prev => {
      if (!isDirty) {
        const next = { ...prev };
        delete next[agentId];
        return next;
      }
      if (prev[agentId]?.startH === startH && prev[agentId]?.endH === endH) return prev;
      return { ...prev, [agentId]: { startH, endH } };
    });
  };

  const allDirtyIds = new Set([
    ...Object.keys(dirtyAgentSettings).map(Number),
    ...Array.from(offTogglePending),
  ]);
  const dirtyCount = allDirtyIds.size;

  useEffect(() => {
    if (dirtyCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyCount]);

  useEffect(() => {
    if (dirtyCount === 0) return;
    const handler = (e: MouseEvent) => {
      const navEl = (e.target as Element).closest('[data-testid*="nav-"]');
      if (!navEl) return;
      const confirmed = window.confirm(
        `You have ${dirtyCount} unapplied schedule change${dirtyCount > 1 ? "s" : ""}.\nLeave without applying?`
      );
      if (!confirmed) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [dirtyCount]);

  const handleApplyAll = () => {
    if (allDirtyIds.size === 0) return;
    for (const agentId of Array.from(allDirtyIds)) {
      const localSettings = dirtyAgentSettings[agentId];
      const agentShifts = allShifts.filter(s => s.agentId === agentId);
      const { start, end } = localSettings
        ? { start: localSettings.startH, end: localSettings.endH }
        : seedFromShifts(agentShifts);
      applyWeekMutation.mutate({ id: agentId, startUtc: start, endUtc: end });
    }
    toast({ title: `Applying templates for ${allDirtyIds.size} agent${allDirtyIds.size > 1 ? "s" : ""}…` });
  };

  const handleExportSettings = async () => {
    try {
      const res = await fetch("/api/export", { headers: { "x-admin-token": getEffectiveAdminToken() } });
      if (!res.ok) {
        const text = (await res.text()) || `HTTP ${res.status}`;
        throw new Error(text);
      }
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shiftclock-backup-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Settings exported" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.agents)) {
        toast({ title: "Invalid backup file", variant: "destructive" });
        return;
      }
      const agentsWithShifts = parsed.agents.map((ag: Agent) => ({
        ...ag,
        shifts: (parsed.shifts ?? []).filter((s: Shift) => s.agentId === ag.id).map(({ id: _id, agentId: _agentId, ...s }: any) => s),
      }));
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": getEffectiveAdminToken() },
        body: JSON.stringify({ agents: agentsWithShifts }),
      });
      if (!res.ok) {
        const text = (await res.text()) || `HTTP ${res.status}`;
        throw new Error(text);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overtime"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent-logs"] });
      toast({ title: "Settings restored from backup" });
    } catch {
      toast({ title: "Import failed — check the file format", variant: "destructive" });
    }
    if (importFileRef.current) importFileRef.current.value = "";
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-3 sm:p-4 lg:p-6 max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4 sm:mb-6">
          <div>
            <h1 className="text-lg font-semibold">Agents</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{agents.length} agents · global team</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isAdmin && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground border border-border rounded-md px-2 py-1">
                <Lock size={10} />
                Limited mode
              </div>
            )}
            {isAdmin && (
              <>
                <input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
                <button
                  onClick={handleExportSettings}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1.5 transition-colors"
                  title="Export all agents and shifts as a backup JSON"
                >
                  <Download size={12} /> Export
                </button>
                <button
                  onClick={() => importFileRef.current?.click()}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground border border-border rounded-md px-2.5 py-1.5 transition-colors"
                  title="Restore agents and shifts from a backup (replaces current data)"
                >
                  <Upload size={12} /> Import
                </button>
                {dirtyCount > 0 && (
                  <button
                    onClick={handleApplyAll}
                    disabled={applyWeekMutation.isPending}
                    title={`Apply pending template changes for ${dirtyCount} agent${dirtyCount > 1 ? "s" : ""}`}
                    className="flex items-center gap-1.5 text-[11px] border rounded-md px-2.5 py-1.5 transition-all animate-pulse disabled:opacity-50 border-amber-400/60 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 ring-1 ring-amber-400/30"
                  >
                    <CalendarDays size={12} />
                    Apply All ({dirtyCount})
                  </button>
                )}
              </>
            )}
            {isAdmin && (
              <Dialog open={showCreate} onOpenChange={setShowCreate}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5" onClick={playSoftClick} data-testid="btn-create-agent">
                    <Plus size={14} /> Add Agent
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>New Agent</DialogTitle>
                  </DialogHeader>
                  <AgentForm
                    defaultColor={DEFAULT_COLORS[agents.length % DEFAULT_COLORS.length]}
                    onSubmit={(data) => createMutation.mutate(data)}
                    loading={createMutation.isPending}
                    playSuccess={playSuccess}
                    playSoftClick={playSoftClick}
                  />
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        <div className="space-y-3 sm:space-y-4">
          {agents.map(agent => {
            const agentShifts = allShifts.filter(s => s.agentId === agent.id);
            const offDays = getOffDays(agent.offWeekend ?? 1);
            return (
              <div
                key={agent.id}
                className="p-4 rounded-xl border border-border bg-card hover:border-opacity-50 transition-all"
                style={{ borderColor: agent.color + "25" }}
                data-testid={`card-agent-${agent.id}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                      style={{
                        backgroundColor: agent.color + "20",
                        border: `2px solid ${agent.color}40`,
                        color: agent.color,
                      }}
                    >
                      {agent.avatarUrl
                        ? <img src={agent.avatarUrl} className="w-full h-full rounded-full object-cover" alt={agent.name} />
                        : agent.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{agent.name}</p>
                      <p className="text-[10px] text-muted-foreground">{agent.role}</p>
                    </div>
                  </div>
                  {(isAdmin || agentSession?.agentId === agent.id) && (
                    <div className="flex items-center gap-1">
                      <Dialog open={editingAgent?.id === agent.id} onOpenChange={open => !open && setEditingAgent(null)}>
                        <DialogTrigger asChild>
                          <button
                            onClick={() => { playSoftClick(); setEditingAgent(agent); }}
                            className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                            data-testid={`btn-edit-agent-${agent.id}`}
                          >
                            <Pencil size={13} />
                          </button>
                        </DialogTrigger>
                        <DialogContent className="max-w-md">
                          <DialogHeader>
                            <DialogTitle>Edit {agent.name}</DialogTitle>
                          </DialogHeader>
                          {editingAgent?.id === agent.id && (
                            <AgentForm
                              defaultValues={{
                                name: agent.name,
                                color: agent.color,
                                timezone: agent.timezone,
                                role: agent.role,
                                avatarUrl: agent.avatarUrl || "",
                              }}
                              onSubmit={(data) => updateMutation.mutate({ id: agent.id, data })}
                              loading={updateMutation.isPending}
                              playSuccess={playSuccess}
                              playSoftClick={playSoftClick}
                            />
                          )}
                        </DialogContent>
                      </Dialog>

                      {isAdmin && (
                        <button
                          onClick={() => { playSoftClick(); deleteMutation.mutate(agent.id); }}
                          className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                          data-testid={`btn-delete-agent-${agent.id}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 mb-2">
                  <Clock size={11} className="text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground font-mono">{agent.timezone}</span>
                  <span className="text-[10px] text-muted-foreground ml-1">
                    ({getLocalTime(agent.timezone)})
                  </span>
                </div>

                {isAdmin && (
                  <div className="flex items-center justify-between mb-3 gap-2">
                    <button
                      onClick={() => { playSoftClick(); toggleOffDayMutation.mutate({ id: agent.id, offWeekend: (agent.offWeekend ?? 1) === 1 ? 0 : 1 }); }}
                      className={cn(
                        "flex items-center gap-1.5 text-[9px] px-2 py-1 rounded-md border transition-all font-medium",
                        (agent.offWeekend ?? 1) === 1
                          ? "border-border bg-muted text-muted-foreground"
                          : "border-primary/40 bg-primary/10 text-primary"
                      )}
                      title="Toggle days off: Weekend (Sat/Sun) or Midweek (Thu/Fri)"
                    >
                      <CalendarDays size={10} />
                      {(agent.offWeekend ?? 1) === 1 ? "Day off at weekend" : "Day off at Thu/Fri"}
                    </button>

                    <ApplyWeekRow
                      agentId={agent.id}
                      agentShifts={agentShifts}
                      offWeekend={agent.offWeekend ?? 1}
                      onApply={(startUtc, endUtc) => applyWeekMutation.mutate({ id: agent.id, startUtc, endUtc })}
                      loading={applyWeekMutation.isPending}
                      playSuccess={playSuccess}
                      onDirtyChange={handleAgentDirtyChange}
                      forceDirty={offTogglePending.has(agent.id)}
                    />
                  </div>
                )}

                <div className="flex flex-wrap gap-1">
                  {DAYS.map((day, di) => {
                    const shift = agentShifts.find(s => s.dayOfWeek === di);
                    const isDayOff = offDays.includes(di);
                    return (
                      <ShiftPill
                        key={di}
                        day={day}
                        dayIdx={di}
                        shift={shift}
                        agentId={agent.id}
                        color={agent.color}
                        isAdmin={isAdmin}
                        isDayOff={isDayOff}
                        agentShifts={agentShifts}
                        onUpsert={upsertShiftMutation.mutate}
                        onUpdateShift={(id, data) => updateShiftMutation.mutate({ id, data })}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
