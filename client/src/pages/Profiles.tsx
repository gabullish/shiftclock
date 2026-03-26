import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Agent, Shift } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Clock, Coffee, AlertTriangle, X, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminMode } from "@/hooks/use-admin-mode";

const TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Sao_Paulo", "America/Mexico_City", "America/Toronto",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Moscow",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Singapore",
  "Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai",
  "Australia/Sydney", "Australia/Melbourne",
  "Pacific/Auckland", "Pacific/Honolulu",
  "Africa/Nairobi", "Africa/Lagos",
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

function formatHour(h: number) {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h % 1) * 60);
  return `${hh.toString().padStart(2,"0")}:${mm.toString().padStart(2,"0")}`;
}

// Returns true if breakStart is within first or last hour of the shift
function isBreakBadTiming(breakStart: number, startUtc: number, endUtc: number): boolean {
  const shiftDur = endUtc > startUtc ? endUtc - startUtc : 24 - startUtc + endUtc;
  const breakEnd = breakStart + 0.5;
  // Too early: break starts in first hour
  const breakRelStart = breakStart >= startUtc ? breakStart - startUtc : 24 - startUtc + breakStart;
  // Too late: break ends in last hour (within 1h of end)
  const breakRelEnd = breakEnd >= startUtc ? breakEnd - startUtc : 24 - startUtc + breakEnd;
  return breakRelStart < 1.0 || breakRelEnd > shiftDur - 1.0;
}

export default function Profiles() {
  const { toast } = useToast();
  const isAdmin = useAdminMode();
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

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
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
                <Button size="sm" className="gap-1.5" data-testid="btn-create-agent">
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
                />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Agent grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {agents.map(agent => {
          const agentShifts = allShifts.filter(s => s.agentId === agent.id);
          return (
            <div
              key={agent.id}
              className="p-4 rounded-xl border border-border bg-card hover:border-opacity-50 transition-all"
              style={{ borderColor: agent.color + "25" }}
              data-testid={`card-agent-${agent.id}`}
            >
              {/* Agent header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  {/* Avatar */}
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
                    {/* Edit */}
                    <Dialog open={editingAgent?.id === agent.id} onOpenChange={open => !open && setEditingAgent(null)}>
                      <DialogTrigger asChild>
                        <button
                          onClick={() => setEditingAgent(agent)}
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
                          />
                        )}
                      </DialogContent>
                    </Dialog>

                    <button
                      onClick={() => deleteMutation.mutate(agent.id)}
                      className="p-1.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                      data-testid={`btn-delete-agent-${agent.id}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>

              {/* Timezone */}
              <div className="flex items-center gap-1.5 mb-3">
                <Clock size={11} className="text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground font-mono">{agent.timezone}</span>
                <span className="text-[10px] text-muted-foreground ml-1">
                  ({getLocalTime(agent.timezone)})
                </span>
              </div>

              {/* Shift pills */}
              <div className="flex flex-wrap gap-1">
                {DAYS.map((day, di) => {
                  const shift = agentShifts.find(s => s.dayOfWeek === di);
                  return (
                    <ShiftPill
                      key={di}
                      day={day}
                      dayIdx={di}
                      shift={shift}
                      agentId={agent.id}
                      color={agent.color}
                      isAdmin={isAdmin}
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

// --- Agent Form ---
function AgentForm({
  defaultValues,
  defaultColor = "#FFD700",
  onSubmit,
  loading,
}: {
  defaultValues?: AgentFormData;
  defaultColor?: string;
  onSubmit: (data: AgentFormData) => void;
  loading: boolean;
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
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
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
                  onClick={() => set("color", c)}
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

      {/* Preview */}
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

// --- Shift Pill ---
function ShiftPill({
  day, dayIdx, shift, agentId, color, isAdmin, onUpsert, onUpdateShift
}: {
  day: string;
  dayIdx: number;
  shift: Shift | undefined;
  agentId: number;
  color: string;
  isAdmin: boolean;
  onUpsert: (data: any) => void;
  onUpdateShift: (id: number, data: any) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [startH, setStartH] = useState(shift ? shift.startUtc.toString() : "9");
  const [endH, setEndH] = useState(shift ? shift.endUtc.toString() : "17");
  const [settingBreak, setSettingBreak] = useState(false);
  const [breakH, setBreakH] = useState(
    shift?.breakStart != null ? shift.breakStart.toString() : ""
  );

  const save = () => {
    const s = parseFloat(startH);
    const e = parseFloat(endH);
    if (!isNaN(s) && !isNaN(e) && e > s) {
      onUpsert({ agentId, dayOfWeek: dayIdx, startUtc: s, endUtc: e, activeStart: null, activeEnd: null, breakStart: null });
    }
    setEditing(false);
  };

  const saveBreak = () => {
    if (!shift) return;
    const b = parseFloat(breakH);
    if (!isNaN(b)) {
      onUpdateShift(shift.id, { breakStart: b });
    }
    setSettingBreak(false);
  };

  const clearBreak = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!shift) return;
    onUpdateShift(shift.id, { breakStart: null });
    setBreakH("");
  };

  // Sync local state when shift data changes from server
  const savedBreak = shift?.breakStart;

  // Warning: break in first/last hour
  const showBreakWarning = shift && savedBreak != null &&
    isBreakBadTiming(savedBreak, shift.startUtc, shift.endUtc);

  if (editing && isAdmin) {
    return (
      <div className="flex items-center gap-1 text-[9px] bg-muted rounded p-1">
        <span className="text-muted-foreground">{day}</span>
        <input
          type="number" min="0" max="23" step="0.5"
          value={startH}
          onChange={e => setStartH(e.target.value)}
          className="w-8 bg-accent rounded text-center text-[9px] font-mono"
        />
        <span>-</span>
        <input
          type="number" min="0.5" max="24" step="0.5"
          value={endH}
          onChange={e => setEndH(e.target.value)}
          className="w-8 bg-accent rounded text-center text-[9px] font-mono"
        />
        <button onClick={save} className="text-primary font-bold">✓</button>
        <button onClick={() => setEditing(false)} className="text-muted-foreground">✕</button>
      </div>
    );
  }

  // Break input form
  if (settingBreak && isAdmin && shift) {
    const shiftDur = shift.endUtc > shift.startUtc
      ? shift.endUtc - shift.startUtc
      : 24 - shift.startUtc + shift.endUtc;
    const warnNow = breakH !== "" && !isNaN(parseFloat(breakH)) &&
      isBreakBadTiming(parseFloat(breakH), shift.startUtc, shift.endUtc);
    return (
      <div className="flex flex-col gap-1 text-[9px] bg-muted rounded p-1.5 min-w-[120px]">
        <div className="flex items-center gap-1">
          <Coffee size={9} style={{ color }} />
          <span className="text-muted-foreground font-medium">Break start (UTC)</span>
        </div>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={shift.startUtc}
            max={shift.endUtc - 0.5}
            step="0.5"
            value={breakH}
            placeholder={`${shift.startUtc + 1}–${shift.endUtc - 1.5}`}
            onChange={e => setBreakH(e.target.value)}
            className="w-14 bg-accent rounded text-center text-[9px] font-mono"
            autoFocus
          />
          <button onClick={saveBreak} className="text-primary font-bold">✓</button>
          <button onClick={() => setSettingBreak(false)} className="text-muted-foreground">✕</button>
        </div>
        {warnNow && (
          <div className="flex items-center gap-1 text-amber-400">
            <AlertTriangle size={8} />
            <span>First or last hour — not ideal</span>
          </div>
        )}
        <div className="text-muted-foreground opacity-60">
          Shift: {formatHour(shift.startUtc)} – {formatHour(shift.endUtc)} · {shiftDur}h
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => isAdmin && setEditing(true)}
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
          title={shift ? `${formatHour(shift.startUtc)} – ${formatHour(shift.endUtc)} UTC` : "No shift"}
        >
          {shift ? `${day} ${formatHour(shift.startUtc)}` : day}
        </button>

        {/* Break button — only shown if shift exists */}
        {shift && (
          <button
            onClick={() => isAdmin && setSettingBreak(true)}
            title={savedBreak != null ? `Break at ${formatHour(savedBreak)}` : "Set break"}
            className={cn(
              "p-0.5 rounded transition-all",
              savedBreak != null ? "opacity-100" : "opacity-30 hover:opacity-70",
              !isAdmin && "cursor-default pointer-events-none"
            )}
            style={{ color: showBreakWarning ? "#F59E0B" : savedBreak != null ? color : "hsl(var(--muted-foreground))" }}
          >
            <Coffee size={9} />
          </button>
        )}

        {/* Clear break — only if break is set and admin */}
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

      {/* Break info row */}
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
