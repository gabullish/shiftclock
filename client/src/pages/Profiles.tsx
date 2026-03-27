import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Agent, Shift } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useSoothingSounds } from "@/hooks/useSoothingSounds";
import { Plus, Pencil, Trash2, Clock, Coffee, AlertTriangle, X, Lock, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminMode } from "@/hooks/use-admin-mode";

const TIMEZONES = [
  "UTC",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Sao_Paulo", "America/Bogota", "America/Santo_Domingo",
  "America/Mexico_City", "America/Toronto",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Madrid",
  "Europe/Zagreb", "Europe/Moscow",
  "Africa/Johannesburg", "Africa/Casablanca", "Africa/Lagos",
  "Africa/Nairobi", "Africa/Addis_Ababa",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Singapore",
  "Asia/Manila", "Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai",
  "Australia/Sydney", "Australia/Melbourne",
  "Pacific/Auckland", "Pacific/Honolulu",
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DEFAULT_COLORS = [
  "#FFD700", "#FFA500", "#FF6B35", "#E63946", "#7B2FBE",
  "#2196F3", "#00BCD4", "#4CAF50", "#FF4081", "#00E676",
  "#FF9800", "#9C27B0", "#03A9F4",
];

interface AgentFormData {
  name: string;
  color: string;
  timezone: string;
  role: string;
  avatarUrl: string;
}

const HALF_HOUR_OPTIONS = Array.from({ length: 48 }, (_, i) => i * 0.5);

function formatHour(h: number) {
  const norm = ((h % 24) + 24) % 24;
  const hh = Math.floor(norm);
  const mm = Math.round((norm % 1) * 60);
  return `${hh.toString().padStart(2, "00")}:${mm.toString().padStart(2, "0")}`;
}

function isOvernight(startUtc: number, endUtc: number) {
  return endUtc < startUtc;
}

function shiftLabel(startUtc: number, endUtc: number) {
  return `${formatHour(startUtc)} – ${formatHour(endUtc)}${isOvernight(startUtc, endUtc) ? " (+1)" : ""}`;
}

function shiftDurH(startUtc: number, endUtc: number) {
  return endUtc > startUtc ? endUtc - startUtc : 24 - startUtc + endUtc;
}

function isBreakBadTiming(breakStart: number, startUtc: number, endUtc: number): boolean {
  const dur = shiftDurH(startUtc, endUtc);
  let rel = breakStart - startUtc;
  if (rel < 0) rel += 24;
  return rel < 1.0 || rel + 0.5 > dur - 1.0;
}

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

export default function Profiles() {
  const { toast } = useToast();
  const isAdmin = useAdminMode();
  const { playSoftClick, playSuccess } = useSoothingSounds();
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [showCreate, setShowCreate] = useState(false);

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
    mutationFn: ({ id, data }: { id: number; data: Partial<AgentFormData> }) =>
      apiRequest("PATCH", `/api/agents/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      setEditingAgent(null);
      toast({ title: "Agent updated" });
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
    mutationFn: (data: any) => apiRequest("POST", "/api/shifts", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/shifts"] }),
  });

  const updateShiftMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      toast({ title: "Days off updated" });
    },
  });

  const applyWeekMutation = useMutation({
    mutationFn: ({ id, startUtc, endUtc }: { id: number; startUtc: number; endUtc: number }) =>
      apiRequest("POST", `/api/agents/${id}/apply-week`, { startUtc, endUtc }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      toast({ title: "Week template applied" });
    },
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold">Agents</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{agents.length} agents · global team</p>
          </div>
          <div className="flex items-center gap-2">
            {!isAdmin && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground border border-border rounded-md px-2 py-1">
                <Lock size={10} />
                View-only
              </div>
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

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pb-8">
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
                  {isAdmin && (
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

                      <button
                        onClick={() => { playSoftClick(); deleteMutation.mutate(agent.id); }}
                        className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                        data-testid={`btn-delete-agent-${agent.id}`}
                      >
                        <Trash2 size={13} />
                      </button>
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
                      {(agent.offWeekend ?? 1) === 1 ? "Off: Sat/Sun" : "Off: Thu/Fri"}
                    </button>

                    <ApplyWeekRow
                      agentId={agent.id}
                      agentShifts={agentShifts}
                      offWeekend={agent.offWeekend ?? 1}
                      onApply={(startUtc, endUtc) => applyWeekMutation.mutate({ id: agent.id, startUtc, endUtc })}
                      loading={applyWeekMutation.isPending}
                      playSuccess={playSuccess}
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

function ApplyWeekRow({
  agentId, agentShifts, offWeekend, onApply, loading, playSuccess,
}: {
  agentId: number;
  agentShifts: Shift[];
  offWeekend: number;
  onApply: (startUtc: number, endUtc: number) => void;
  loading: boolean;
  playSuccess: () => void;
}) {
  const seed = seedFromShifts(agentShifts);
  const [startH, setStartH] = useState<number>(seed.start);
  const [endH, setEndH]     = useState<number>(seed.end);

  const overnight = endH <= startH;
  const dur       = overnight ? 24 - startH + endH : endH - startH;

  return (
    <div className="flex items-center gap-1">
      <select
        value={startH}
        onChange={e => setStartH(parseFloat(e.target.value))}
        className="w-14 text-[9px] bg-muted border border-border rounded px-1 py-0.5 font-mono"
        title="Start UTC"
      >
        {HALF_HOUR_OPTIONS.map(h => (
          <option key={h} value={h}>{formatHour(h)}</option>
        ))}
      </select>
      <span className="text-[9px] text-muted-foreground">–</span>
      <select
        value={endH}
        onChange={e => setEndH(parseFloat(e.target.value))}
        className="w-14 text-[9px] bg-muted border border-border rounded px-1 py-0.5 font-mono"
        title="End UTC"
      >
        {HALF_HOUR_OPTIONS.map(h => (
          <option key={h} value={h}>{formatHour(h)}{h <= startH ? " (+1)" : ""}</option>
        ))}
      </select>
      {overnight && (
        <span className="text-[9px] text-amber-400 font-mono" title={`${dur}h overnight`}>+1 {dur}h</span>
      )}
      <button
        onClick={() => { playSuccess(); onApply(startH, endH); }}
        disabled={loading || dur <= 0}
        className="text-[9px] px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
      >
        <CalendarDays size={9} />
        Apply week
      </button>
    </div>
  );
}

function AgentForm({
  defaultValues,
  defaultColor = "#FFD700",
  onSubmit,
  loading,
  playSuccess,
  playSoftClick,
}: {
  defaultValues?: AgentFormData;
  defaultColor?: string;
  onSubmit: (data: AgentFormData) => void;
  loading: boolean;
  playSuccess: () => void;
  playSoftClick: () => void;
}) {
  const [form, setForm] = useState<AgentFormData>({
    name: defaultValues?.name || "",
    color: defaultValues?.color || defaultColor,
    timezone: defaultValues?.timezone || "UTC",
    role: defaultValues?.role || "Support Agent",
    avatarUrl: defaultValues?.avatarUrl || "",
  });

  const set = (k: keyof AgentFormData, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); playSuccess(); onSubmit(form); }} className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Name</Label>
        <Input
          value={form.name}
          onChange={e => set("name", e.target.value)}
          placeholder="Agent name"
          required
          data-testid="input-agent-name"
          className="bg-muted border-border text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Role</Label>
        <Input
          value={form.role}
          onChange={e => set("role", e.target.value)}
          placeholder="Support Agent"
          className="bg-muted border-border text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Color</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={form.color}
              onChange={e => set("color", e.target.value)}
              className="w-9 h-9 rounded cursor-pointer bg-transparent border border-border"
              data-testid="input-agent-color"
            />
            <div className="flex flex-wrap gap-1">
              {DEFAULT_COLORS.slice(0, 8).map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { playSoftClick(); set("color", c); }}
                  className="w-4 h-4 rounded-full border border-transparent hover:scale-110 transition-transform"
                  style={{ backgroundColor: c, borderColor: form.color === c ? "white" : "transparent" }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Timezone</Label>
          <Select value={form.timezone} onValueChange={v => set("timezone", v)}>
            <SelectTrigger className="bg-muted border-border text-sm h-9" data-testid="select-timezone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-48">
              {TIMEZONES.map(tz => (
                <SelectItem key={tz} value={tz} className="text-xs">{tz}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Avatar URL (optional)</Label>
        <Input
          value={form.avatarUrl}
          onChange={e => set("avatarUrl", e.target.value)}
          placeholder="https://..."
          className="bg-muted border-border text-sm"
        />
      </div>

      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
          style={{ backgroundColor: form.color + "20", border: `2px solid ${form.color}50`, color: form.color }}
        >
          {form.name ? form.name.slice(0, 2).toUpperCase() : "??"}
        </div>
        <div>
          <p className="text-sm font-medium">{form.name || "Agent name"}</p>
          <p className="text-[10px] text-muted-foreground">{form.role} · {form.timezone}</p>
        </div>
      </div>

      <Button type="submit" disabled={loading} className="w-full" data-testid="btn-submit-agent">
        {loading ? "Saving..." : "Save Agent"}
      </Button>
    </form>
  );
}

function ShiftPill({
  day, dayIdx, shift, agentId, color, isAdmin, isDayOff,
  agentShifts, onUpsert, onUpdateShift,
}: {
  day: string;
  dayIdx: number;
  shift: Shift | undefined;
  agentId: number;
  color: string;
  isAdmin: boolean;
  isDayOff: boolean;
  agentShifts: Shift[];
  onUpsert: (data: any) => void;
  onUpdateShift: (id: number, data: any) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [settingBreak, setSettingBreak] = useState(false);

  function resolveDefaults() {
    if (shift) {
      return {
        s: ((shift.startUtc % 24) + 24) % 24,
        e: ((shift.endUtc   % 24) + 24) % 24,
      };
    }
    const seed = seedFromShifts(agentShifts);
    return { s: seed.start, e: seed.end };
  }

  const def = resolveDefaults();
  const [startH, setStartH] = useState<number>(def.s);
  const [endH, setEndH]     = useState<number>(def.e);
  const [breakH, setBreakH] = useState<string>(
    shift?.breakStart != null ? String(((shift.breakStart % 24) + 24) % 24) : ""
  );

  const openEdit = () => {
    const d = resolveDefaults();
    setStartH(d.s);
    setEndH(d.e);
    setEditing(true);
  };

  const overnight = endH <= startH;
  const dur       = overnight ? 24 - startH + endH : endH - startH;

  const save = () => {
    if (dur <= 0) return;
    onUpsert({
      agentId,
      dayOfWeek: dayIdx,
      startUtc: startH,
      endUtc: endH,
      activeStart: null,
      activeEnd: null,
      breakStart: null,
    });
    setEditing(false);
  };

  const saveBreak = () => {
    if (!shift) return;
    const b = parseFloat(breakH);
    if (!isNaN(b)) onUpdateShift(shift.id, { breakStart: b % 24 });
    setSettingBreak(false);
  };

  const clearBreak = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!shift) return;
    onUpdateShift(shift.id, { breakStart: null });
    setBreakH("");
  };

  const savedBreak = shift?.breakStart;
  const showBreakWarning = shift && savedBreak != null &&
    isBreakBadTiming(savedBreak, shift.startUtc, shift.endUtc);

  if (editing && isAdmin) {
    return (
      <div className="flex flex-col gap-1 text-[9px] bg-muted rounded p-1.5 min-w-[130px]">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground w-5">{day}</span>
          <select
            value={startH}
            onChange={e => setStartH(parseFloat(e.target.value))}
            className="flex-1 bg-accent rounded text-center text-[9px] font-mono"
          >
            {HALF_HOUR_OPTIONS.map(h => (
              <option key={h} value={h}>{formatHour(h)}</option>
            ))}
          </select>
          <span className="text-muted-foreground">–</span>
          <select
            value={endH}
            onChange={e => setEndH(parseFloat(e.target.value))}
            className="flex-1 bg-accent rounded text-center text-[9px] font-mono"
          >
            {HALF_HOUR_OPTIONS.map(h => (
              <option key={h} value={h}>
                {formatHour(h)}{h <= startH ? " (+1)" : ""}
              </option>
            ))}
          </select>
          <button onClick={save} disabled={dur <= 0} className="text-primary font-bold disabled:opacity-40">✓</button>
          <button onClick={() => setEditing(false)} className="text-muted-foreground">✕</button>
        </div>
        <div className="flex items-center gap-1 px-0.5">
          {overnight && <span className="text-amber-400 font-mono">+1</span>}
          <span className="text-muted-foreground">{shiftLabel(startH, endH)} · {dur}h</span>
        </div>
      </div>
    );
  }

  if (settingBreak && isAdmin && shift) {
    const dur2 = shiftDurH(shift.startUtc, shift.endUtc);
    const breakOptions = HALF_HOUR_OPTIONS.filter(h => {
      let rel = h - shift.startUtc;
      if (rel < 0) rel += 24;
      return rel >= 1.0 && rel + 0.5 <= dur2 - 1.0;
    });
    const warnNow = breakH !== "" && !isNaN(parseFloat(breakH)) &&
      isBreakBadTiming(parseFloat(breakH), shift.startUtc, shift.endUtc);
    return (
      <div className="flex flex-col gap-1 text-[9px] bg-muted rounded p-1.5 min-w-[130px]">
        <div className="flex items-center gap-1">
          <Coffee size={9} style={{ color }} />
          <span className="text-muted-foreground font-medium">Break (UTC)</span>
        </div>
        <div className="flex items-center gap-1">
          <select
            value={breakH}
            onChange={e => setBreakH(e.target.value)}
            className="flex-1 bg-accent rounded text-center text-[9px] font-mono"
            autoFocus
          >
            <option value="">pick time</option>
            {breakOptions.map(h => (
              <option key={h} value={h}>{formatHour(h)}</option>
            ))}
          </select>
          <button onClick={saveBreak} disabled={breakH === ""} className="text-primary font-bold disabled:opacity-40">✓</button>
          <button onClick={() => setSettingBreak(false)} className="text-muted-foreground">✕</button>
        </div>
        {warnNow && (
          <div className="flex items-center gap-1 text-amber-400">
            <AlertTriangle size={8} />
            <span>First or last hour — not ideal</span>
          </div>
        )}
        <div className="text-muted-foreground opacity-60">
          {shiftLabel(shift.startUtc, shift.endUtc)} · {dur2}h
        </div>
      </div>
    );
  }

  if (isDayOff && !shift) {
    return (
      <div
        className="text-[9px] px-1.5 py-0.5 rounded"
        style={{
          backgroundColor: "hsl(var(--muted))",
          color: "hsl(var(--muted-foreground))",
          border: "1px solid hsl(var(--border))",
          opacity: 0.4,
        }}
        title="Day off"
      >
        {day}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => isAdmin && openEdit()}
          className={cn(
            "text-[9px] px-1.5 py-0.5 rounded transition-all",
            !isAdmin && "cursor-default"
          )}
          style={shift ? {
            backgroundColor: color + "20",
            color: color,
            border: `1px solid ${color}30`,
          } : {
            backgroundColor: "hsl(var(--muted))",
            color: "hsl(var(--muted-foreground))",
            border: "1px dashed hsl(var(--border))",
          }}
          data-testid={`shift-pill-${agentId}-${dayIdx}`}
          title={shift ? shiftLabel(shift.startUtc, shift.endUtc) + " UTC" : "No shift — click to add"}
        >
          {shift
            ? `${day} ${formatHour(shift.startUtc)}${isOvernight(shift.startUtc, shift.endUtc) ? "*" : ""}`
            : day}
        </button>

        {shift && (
          <button
            onClick={() => isAdmin && setSettingBreak(true)}
            title={savedBreak != null ? `Break at ${formatHour(savedBreak)}` : "Set break"}
            className={cn(
              "p-0.5 rounded transition-all",
              savedBreak != null ? "opacity-100" : "opacity-30 hover:opacity-70",
              !isAdmin && "cursor-default pointer-events-none"
            )}
            style={{
              color: showBreakWarning ? "#F59E0B" : savedBreak != null ? "white" : "hsl(var(--muted-foreground))",
              filter: savedBreak != null && !showBreakWarning ? `drop-shadow(0 0 2px ${color})` : undefined,
            }}
          >
            <Coffee size={9} />
          </button>
        )}

        {shift && savedBreak != null && isAdmin && (
          <button
            onClick={clearBreak}
            title="Clear break"
            className="p-0.5 rounded opacity-40 hover:opacity-100 hover:text-destructive transition-all"
          >
            <X size={8} />
          </button>
        )}
      </div>

      {shift && savedBreak != null && (
        <div className={cn(
          "flex items-center gap-1 text-[8px] px-1",
          showBreakWarning ? "text-amber-400" : "text-muted-foreground"
        )}>
          {showBreakWarning && <AlertTriangle size={7} />}
          <Coffee size={7} />
          <span>{formatHour(savedBreak)}</span>
          {showBreakWarning && <span>· not ideal</span>}
        </div>
      )}
    </div>
  );
}
