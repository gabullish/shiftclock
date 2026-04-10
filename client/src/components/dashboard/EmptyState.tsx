// Shown in the clock/lever area when no shifts are scheduled for the selected day.
import { Clock } from "lucide-react";
import { formatUtcHour } from "@/lib/shiftUtils";
import type { GapSlice } from "@/lib/dashboardUtils";

export function EmptyState({ isWeekend, dayLabel, canClaimCoverage, gapSlices, onAssignGap }: {
  isWeekend: boolean;
  dayLabel: string;
  canClaimCoverage: boolean;
  gapSlices: GapSlice[];
  onAssignGap: (startUtc: number, endUtc: number) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 text-center max-w-xs">
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
        <Clock size={24} className="text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground mb-1">
          {isWeekend ? `${dayLabel} — Weekend` : `No shifts on ${dayLabel}`}
        </p>
        <p className="text-xs text-muted-foreground">
          {isWeekend
            ? "No shifts are scheduled on weekends. Head to Agents to add weekend coverage."
            : "No agents have shifts scheduled for this day. Go to Agents to set up shifts."}
        </p>
      </div>
      {canClaimCoverage && gapSlices.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5">
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
  );
}
