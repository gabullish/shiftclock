import { useState, useEffect, useRef } from "react";
import type { Shift } from "@shared/schema";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatUtcHour } from "@/lib/shiftUtils";

const HALF_HOUR_OPTIONS = Array.from({ length: 48 }, (_, i) => i * 0.5);

function seedFromShifts(shifts: Shift[]): { start: number; end: number } {
  const s = shifts.find(sh => sh.startUtc != null && sh.endUtc != null);
  if (!s) return { start: 9, end: 17 };
  return {
    start: ((s.startUtc % 24) + 24) % 24,
    end:   ((s.endUtc   % 24) + 24) % 24,
  };
}

export function ApplyWeekRow({
  agentId, agentShifts, offWeekend, onApply, loading, playSuccess, onDirtyChange, forceDirty,
}: {
  agentId: number;
  agentShifts: Shift[];
  offWeekend: number;
  onApply: (startUtc: number, endUtc: number) => void;
  loading: boolean;
  playSuccess: () => void;
  onDirtyChange?: (agentId: number, isDirty: boolean, startH: number, endH: number) => void;
  // forceDirty: allows the parent (Profiles) to mark this row as dirty even when
  // the local time pickers match the server seed. Used after a bulk import so that
  // all rows show the Apply button, prompting the manager to confirm the new
  // schedule rather than silently leaving old shifts in place.
  forceDirty?: boolean;
}) {
  const seed = seedFromShifts(agentShifts);
  const [startH, setStartH] = useState<number>(seed.start);
  const [endH, setEndH]     = useState<number>(seed.end);

  // Sync local state when shifts change externally (e.g. after import or another client applies)
  const prevSeedRef = useRef({ start: seed.start, end: seed.end });
  useEffect(() => {
    const newSeed = seedFromShifts(agentShifts);
    if (newSeed.start !== prevSeedRef.current.start || newSeed.end !== prevSeedRef.current.end) {
      prevSeedRef.current = newSeed;
      setStartH(newSeed.start);
      setEndH(newSeed.end);
    }
  }, [agentShifts]);

  const overnight  = endH <= startH;
  const dur        = overnight ? 24 - startH + endH : endH - startH;
  const serverSeed = seedFromShifts(agentShifts);
  const isDirty    = forceDirty || startH !== serverSeed.start || endH !== serverSeed.end;

  // Notify parent whenever dirty state changes
  useEffect(() => {
    onDirtyChange?.(agentId, isDirty, startH, endH);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, startH, endH, agentId]);

  const handleApplyClick = () => {
    if (dur <= 0) return;
    playSuccess();
    onApply(startH, endH);
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      <select
        value={startH}
        onChange={e => setStartH(parseFloat(e.target.value))}
        className={cn(
          "w-16 text-xs bg-muted rounded px-1 py-1 font-mono border transition-colors min-h-[28px]",
          isDirty ? "border-amber-400/60" : "border-border"
        )}
        title="Start UTC"
      >
        {HALF_HOUR_OPTIONS.map(h => (
          <option key={h} value={h}>{formatUtcHour(h)}</option>
        ))}
      </select>
      <span className="text-[10px] text-muted-foreground">–</span>
      <select
        value={endH}
        onChange={e => setEndH(parseFloat(e.target.value))}
        className={cn(
          "w-16 text-xs bg-muted rounded px-1 py-1 font-mono border transition-colors min-h-[28px]",
          isDirty ? "border-amber-400/60" : "border-border"
        )}
        title="End UTC"
      >
        {HALF_HOUR_OPTIONS.map(h => (
          <option key={h} value={h}>{formatUtcHour(h)}{h <= startH ? " (+1)" : ""}</option>
        ))}
      </select>
      {overnight && (
        <span className="text-[10px] text-amber-400 font-mono" title={`${dur}h overnight`}>+1 {dur}h</span>
      )}
      <button
        onClick={handleApplyClick}
        disabled={loading || dur <= 0}
        title="Apply week template to all working days"
        className={cn(
          "text-xs px-2 py-1 min-h-[28px] rounded flex items-center gap-1 transition-all duration-200",
          "disabled:opacity-50 hover:opacity-90",
          isDirty
            ? "bg-amber-500/20 text-amber-300 border border-amber-400/60 ring-1 ring-amber-400/40 animate-pulse"
            : "bg-primary text-primary-foreground border border-transparent"
        )}
      >
        <CalendarDays size={9} />
        Apply week
      </button>
    </div>
  );
}
