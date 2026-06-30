// Modal to mark an agent sick / on vacation for a date range, and to cancel
// existing absences. Managers can set it for any agent; an agent only for self.
import { useState } from "react";
import { X, Trash2 } from "lucide-react";
import type { Agent, Absence } from "@shared/schema";

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function AbsenceModal({
  agents, lockedAgentId, presetType, defaultStart, todayDate, absences,
  onCreate, onCancelAbsence, onClose,
}: {
  agents: Agent[];
  lockedAgentId: number | null;          // non-null = agent self-service (can't pick others)
  presetType?: "sick" | "vacation";
  defaultStart: string;                  // ISO YYYY-MM-DD
  todayDate: string;
  absences: Absence[];
  onCreate: (data: { agentId: number; type: "sick" | "vacation"; startDate: string; endDate: string }) => void;
  onCancelAbsence: (id: number) => void;
  onClose: () => void;
}) {
  const [agentId, setAgentId] = useState<number>(lockedAgentId ?? agents[0]?.id ?? 0);
  const [type, setType] = useState<"sick" | "vacation">(presetType ?? "vacation");
  const [start, setStart] = useState<string>(defaultStart);
  const [days, setDays] = useState<number>(presetType === "sick" ? 1 : 5);
  // Two-step confirm on cancel — a stray click shouldn't drop an absence.
  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null);

  const endDate = addDaysIso(start, Math.max(1, days) - 1);
  const agentName = (id: number) => agents.find(a => a.id === id)?.name ?? "Agent";

  // Current + upcoming absences (hide ones already finished).
  const upcoming = [...absences]
    .filter(a => a.endDate >= todayDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const canSubmit = agentId > 0 && start && days >= 1 && endDate >= start;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold">Mark absent</p>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors" aria-label="Close">
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>

        <div className="p-3 space-y-3">
          {/* Agent (manager only) */}
          {lockedAgentId == null ? (
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Agent</label>
              <select
                value={agentId}
                onChange={(e) => setAgentId(Number(e.target.value))}
                className="mt-1 w-full text-xs rounded-md bg-muted border border-border px-2 py-2"
              >
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">For <span className="font-medium text-foreground">{agentName(agentId)}</span></p>
          )}

          {/* Type */}
          <div className="flex gap-2">
            {(["vacation", "sick"] as const).map(t => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`flex-1 text-xs py-2 rounded-md border transition-colors ${
                  type === t ? "border-primary bg-primary/15 text-primary" : "border-border bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "vacation" ? "🏖️ Vacation" : "🏥 Sick"}
              </button>
            ))}
          </div>

          {/* Start + length */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Start</label>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
                className="mt-1 w-full text-xs rounded-md bg-muted border border-border px-2 py-2" />
            </div>
            <div className="w-20">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Days</label>
              <input type="number" min={1} value={days}
                onChange={(e) => setDays(Math.max(1, parseInt(e.target.value || "1", 10)))}
                className="mt-1 w-full text-xs rounded-md bg-muted border border-border px-2 py-2" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {start === endDate ? start : `${start} → ${endDate}`} · their shifts on these days free up for coverage.
          </p>

          <button
            disabled={!canSubmit}
            onClick={() => onCreate({ agentId, type, startDate: start, endDate })}
            className="w-full text-xs py-2 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50"
          >
            Mark {type === "vacation" ? "on vacation" : "out sick"}
          </button>
        </div>

        {/* Current + upcoming absences */}
        {upcoming.length > 0 && (
          <div className="border-t border-border p-3 max-h-44 overflow-y-auto">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Current &amp; upcoming</p>
            <div className="space-y-1">
              {upcoming.map(a => {
                const canCancel = lockedAgentId == null || lockedAgentId === a.agentId;
                return (
                  <div key={a.id} className="flex items-center justify-between text-[11px] gap-2">
                    <span className="truncate">
                      <span className="font-medium">{agentName(a.agentId)}</span>
                      <span className="text-muted-foreground ml-1">
                        {a.type === "vacation" ? "🏖️" : "🏥"} {a.startDate === a.endDate ? a.startDate : `${a.startDate}→${a.endDate}`}
                      </span>
                    </span>
                    {canCancel && (
                      confirmCancelId === a.id ? (
                        <button onClick={() => { setConfirmCancelId(null); onCancelAbsence(a.id); }} title="Confirm cancel"
                          className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors">
                          Confirm?
                        </button>
                      ) : (
                        <button onClick={() => setConfirmCancelId(a.id)} title="Cancel absence"
                          className="shrink-0 p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 size={11} />
                        </button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
