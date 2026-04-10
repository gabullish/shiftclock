// Fullscreen modal for assigning freed hours or an open gap to another agent.
// Caller is responsible for filtering which agents appear in the list.
import { X } from "lucide-react";
import type { Agent, Shift } from "@shared/schema";
import { formatDuration, formatUtcHour } from "@/lib/shiftUtils";
import { formatWeekdayWithDate } from "@/lib/dashboardUtils";

type OvertimeSource =
  | {
      kind: "shift";
      shift: Shift;
      fromAgent: Agent;
      dayOfWeek: number;
      date: string;
      startUtc: number;
      endUtc: number;
      freedHours: number;
    }
  | {
      kind: "gap";
      dayOfWeek: number;
      date: string;
      startUtc: number;
      endUtc: number;
      freedHours: number;
    };

export function AssignOvertimeModal({ source, agents, onAssign, onClose }: {
  source: OvertimeSource;
  agents: Agent[];
  onAssign: (toAgentId: number) => void;
  onClose: () => void;
}) {
  const sourceLabel = source.kind === "shift"
    ? `${formatDuration(source.freedHours)} freed from ${source.fromAgent.name}'s ${formatWeekdayWithDate(source.dayOfWeek, source.date)} shift`
    : `${formatDuration(source.freedHours)} open gap on ${formatWeekdayWithDate(source.dayOfWeek, source.date)} · ${formatUtcHour(source.startUtc)}-${formatUtcHour(source.endUtc)} UTC`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <p className="text-sm font-semibold">Assign Overtime</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {source.kind === "shift" ? (
                <>
                  {formatDuration(source.freedHours)} freed from{" "}
                  <span style={{ color: source.fromAgent.color }}>{source.fromAgent.name}</span>'s {formatWeekdayWithDate(source.dayOfWeek, source.date)} shift
                </>
              ) : (
                sourceLabel
              )}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>

        <div className="p-2 max-h-64 overflow-y-auto">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-2 pb-1.5">
            Select an agent to receive this overtime
          </p>
          {agents.length === 0 ? (
            <p className="text-[11px] text-muted-foreground px-3 py-4 text-center">
              No agents are scheduled on this day.
            </p>
          ) : agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => onAssign(agent.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/70 transition-all group text-left"
            >
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: agent.color }} />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium">{agent.name}</span>
                <span className="text-[10px] text-muted-foreground ml-2">{agent.role}</span>
              </div>
              <span className="text-[10px] text-muted-foreground group-hover:text-primary transition-colors">
                +{formatDuration(source.freedHours)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
