// Coverage report panel at the bottom of the Dashboard — shows per-agent hours,
// OT, released hours, pending claims, and gap alerts for the selected day.
import { ExternalLink } from "lucide-react";
import type { Agent, Shift, OvertimeLog } from "@shared/schema";
import { formatDuration, formatUtcHour } from "@/lib/shiftUtils";
import { formatWeekdayWithDate, type AgentSummary, type GapSlice } from "@/lib/dashboardUtils";

export function SummaryPanel({
  agentSummaries,
  selectedDay,
  selectedDate,
  zeroCoverageHours,
  peakCoverageHour: _peakCoverageHour, // kept in props for future use
  totalOvertimeHours,
  totalReleasedHours,
  canClaimCoverage,
  gapSlices,
  onAssignGap,
  pendingClaims,
  agents,
  onOpenOvertime,
}: {
  agentSummaries: AgentSummary[];
  selectedDay: number;
  selectedDate: string;
  zeroCoverageHours: number;
  peakCoverageHour: number;
  totalOvertimeHours: number;
  totalReleasedHours: number;
  canClaimCoverage: boolean;
  gapSlices: GapSlice[];
  onAssignGap: (startUtc: number, endUtc: number) => void;
  pendingClaims: OvertimeLog[];
  agents: Agent[];
  onOpenOvertime: (record: OvertimeLog) => void;
}) {
  const agentMap      = new Map<number, Agent>(agents.map(a => [a.id, a]));
  const coveredByName = (id: number | null) => (id != null ? agentMap.get(id)?.name : null);

  return (
    <div className="border-t border-border p-3 max-h-52 min-h-0 overflow-y-auto overscroll-contain bg-card/30 shrink-0">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 font-medium">
        Coverage Report · {formatWeekdayWithDate(selectedDay, selectedDate)}
      </p>

      {zeroCoverageHours > 0 && (
        <div className="mb-2 p-2 rounded bg-red-500/10 border border-red-500/20">
          <p className="text-[10px] text-red-400 font-medium">
            ⚠ {zeroCoverageHours} hour{zeroCoverageHours !== 1 ? "s" : ""} with zero coverage
          </p>
          {canClaimCoverage && gapSlices.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {gapSlices.slice(0, 8).map((gap) => (
                <button
                  key={`${gap.startUtc}-${gap.endUtc}`}
                  onClick={() => onAssignGap(gap.startUtc, gap.endUtc)}
                  className="text-[10px] px-2 py-1 rounded-md border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/15 transition-colors"
                >
                  {"Join line "}{formatUtcHour(gap.startUtc)}-{formatUtcHour(gap.endUtc)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {pendingClaims.length > 0 && (
        <div className="mb-2 p-2 rounded border border-amber-500/30 bg-amber-500/10">
          <p className="text-[10px] text-amber-300 font-medium mb-1">
            {pendingClaims.length} claim{pendingClaims.length !== 1 ? "s" : ""} waiting manager approval
          </p>
          <div className="space-y-1">
            {pendingClaims.slice(0, 4).map((claim) => {
              const target   = agentMap.get(claim.agentId)?.name ?? "Agent";
              const fromName = coveredByName(claim.coveredByAgentId);
              const context  = claim.origin === "claimed-open-gap"
                ? `open gap ${formatUtcHour(claim.coverStartUtc!)}-${formatUtcHour(claim.coverEndUtc!)} UTC`
                : `${fromName ?? "agent"} → ${target} ${formatUtcHour(claim.coverStartUtc!)}-${formatUtcHour(claim.coverEndUtc!)} UTC`;
              return (
                <button
                  key={claim.id}
                  onClick={() => onOpenOvertime(claim)}
                  className="w-full flex items-center justify-between text-left text-[10px] text-amber-100 hover:text-primary transition-colors"
                  title="Open overtime log"
                >
                  <span>{target} waiting approval from manager · {context}</span>
                  <ExternalLink size={10} className="opacity-60 shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-1">
        {agentSummaries.map(({ agent, baseHours, activeHours, overtimeHours, releasedHours, coveredOutHours, coveredByAgentId, shifts: agentShifts }) => {
          if (baseHours === 0) return null;
          const uncoveredHours = Math.max(0, releasedHours - coveredOutHours);
          const coveredName    = coveredByAgentId != null ? agentMap.get(coveredByAgentId)?.name : null;
          const breakShift     = agentShifts.find(s => s.breakStart != null);
          return (
            <div key={agent.id} className="flex items-start gap-2 text-[10px]">
              <div className="w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ backgroundColor: agent.color }} />
              <div className="flex-1">
                <span className="font-medium text-foreground">{agent.name}</span>
                <span className="text-muted-foreground ml-1">{formatDuration(activeHours)}</span>
                {overtimeHours > 0 && <span className="ml-1" style={{ color: agent.color }}>+{formatDuration(overtimeHours)} OT</span>}
                {releasedHours > 0 && coveredName && uncoveredHours <= 0 && (
                  <span className="ml-1 text-emerald-400">{formatDuration(releasedHours)} → {coveredName}</span>
                )}
                {releasedHours > 0 && coveredName && uncoveredHours > 0 && (
                  <>
                    <span className="ml-1 text-emerald-400">{formatDuration(coveredOutHours)} → {coveredName}</span>
                    <span className="ml-1 text-orange-400">{formatDuration(uncoveredHours)} open</span>
                  </>
                )}
                {releasedHours > 0 && !coveredName && uncoveredHours > 0 && (
                  <span className="ml-1 text-orange-400">{formatDuration(uncoveredHours)} up for grabs</span>
                )}
                {breakShift && breakShift.breakStart != null && (
                  <span className="ml-1 text-muted-foreground/60">· ☕ {formatUtcHour(breakShift.breakStart)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {(() => {
        const totalCovered = agentSummaries.reduce((a, s) => a + s.coveredOutHours, 0);
        if (totalOvertimeHours === 0 && totalReleasedHours === 0 && totalCovered === 0) return null;
        return (
          <div className="mt-2 pt-2 border-t border-border">
            {totalOvertimeHours > 0 && <p className="text-[10px] text-primary">Total overtime: +{formatDuration(totalOvertimeHours)}</p>}
            {totalCovered > 0 && <p className="text-[10px] text-emerald-400">Coverage filled: {formatDuration(totalCovered)}</p>}
            {totalReleasedHours > 0 && <p className="text-[10px] text-orange-400">Still up for grabs: {formatDuration(totalReleasedHours)}</p>}
          </div>
        );
      })()}
    </div>
  );
}
