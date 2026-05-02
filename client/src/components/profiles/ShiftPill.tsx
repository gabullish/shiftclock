import { useState, useEffect } from "react";
import type { Shift, InsertShift } from "@shared/schema";
import { Coffee, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatUtcHour, shiftDuration, resolveBreak } from "@/lib/shiftUtils";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HALF_HOUR_OPTIONS = Array.from({ length: 48 }, (_, i) => i * 0.5);

function isOvernight(startUtc: number, endUtc: number) {
  return endUtc < startUtc;
}

function shiftLabel(startUtc: number, endUtc: number, dayIdx?: number) {
  const overnight = isOvernight(startUtc, endUtc);
  if (overnight && dayIdx != null) {
    const prevDay = DAYS[(dayIdx + 6) % 7];
    const curDay = DAYS[dayIdx];
    return `${prevDay}/${curDay} ${formatUtcHour(startUtc)} – ${formatUtcHour(endUtc)}`;
  }
  return `${formatUtcHour(startUtc)} – ${formatUtcHour(endUtc)}${overnight ? " (+1)" : ""}`;
}

function seedFromShifts(shifts: Shift[]): { start: number; end: number } {
  const s = shifts.find(sh => sh.startUtc != null && sh.endUtc != null);
  if (!s) return { start: 9, end: 17 };
  return {
    start: ((s.startUtc % 24) + 24) % 24,
    end:   ((s.endUtc   % 24) + 24) % 24,
  };
}

export function ShiftPill({
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
  onUpsert: (data: InsertShift) => void;
  onUpdateShift: (id: number, data: Partial<InsertShift>) => void;
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

  // Keep breakH in sync when shift prop updates externally (e.g. after another admin saves)
  useEffect(() => {
    setBreakH(shift?.breakStart != null ? String(((shift.breakStart % 24) + 24) % 24) : "");
  }, [shift?.breakStart]);

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
    (resolveBreak(savedBreak, shift.startUtc, shift.endUtc)?.isBadTiming ?? false);

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
              <option key={h} value={h}>{formatUtcHour(h)}</option>
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
                {formatUtcHour(h)}{h <= startH ? " (+1)" : ""}
              </option>
            ))}
          </select>
          <button onClick={save} disabled={dur <= 0} className="text-primary font-bold disabled:opacity-40">✓</button>
          <button onClick={() => setEditing(false)} className="text-muted-foreground">✕</button>
        </div>
        <div className="flex items-center gap-1 px-0.5">
          {overnight && <span className="text-amber-400 font-mono">{DAYS[(dayIdx + 6) % 7]}/{DAYS[dayIdx]}</span>}
          <span className="text-muted-foreground">{shiftLabel(startH, endH, dayIdx)} · {dur}h</span>
        </div>
      </div>
    );
  }

  if (settingBreak && isAdmin && shift) {
    const dur2 = shiftDuration(shift.startUtc, shift.endUtc);
    const breakOptions = HALF_HOUR_OPTIONS.filter(h => {
      let rel = h - shift.startUtc;
      if (rel < 0) rel += 24;
      return rel >= 1.0 && rel + 0.5 <= dur2 - 1.0;
    });
    const warnNow = breakH !== "" && !isNaN(parseFloat(breakH)) &&
      (resolveBreak(parseFloat(breakH), shift.startUtc, shift.endUtc)?.isBadTiming ?? false);
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
              <option key={h} value={h}>{formatUtcHour(h)}</option>
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
          {shiftLabel(shift.startUtc, shift.endUtc, dayIdx)} · {dur2}h
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
          title={shift ? shiftLabel(shift.startUtc, shift.endUtc, dayIdx) + " UTC" : "No shift — click to add"}
        >
          {shift
            ? isOvernight(shift.startUtc, shift.endUtc)
              ? `${DAYS[(dayIdx + 6) % 7]}/${day} ${formatUtcHour(shift.startUtc)}`
              : `${day} ${formatUtcHour(shift.startUtc)}`
            : day}
        </button>

        {shift && (
          <button
            onClick={() => isAdmin && setSettingBreak(true)}
            title={savedBreak != null ? `Break at ${formatUtcHour(savedBreak)}` : "Set break"}
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
          <span>{formatUtcHour(savedBreak)}</span>
          {showBreakWarning && <span>· not ideal</span>}
        </div>
      )}
    </div>
  );
}
