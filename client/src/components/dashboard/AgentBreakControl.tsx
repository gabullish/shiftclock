// Break button for the agent's own shift card — shows elapsed break time and
// toggles between "take break" and "I'm back".
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function AgentBreakControl({ isOnBreak, startedAt, onBreakStart, onBreakEnd, onLogSick, onLogVacation }: {
  isOnBreak: boolean;
  startedAt: number | null;
  onBreakStart: () => void;
  onBreakEnd: () => void;
  onLogSick: () => void;
  onLogVacation: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  // Two-step confirm on starting a break — matches the dashboard "Online now"
  // pills, so the same action carries the same misclick guard everywhere.
  const [confirmStart, setConfirmStart] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!startedAt) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 60000));
    tick();
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, [startedAt]);

  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  const handleStartClick = () => {
    if (confirmStart) {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      setConfirmStart(false);
      onBreakStart();
    } else {
      setConfirmStart(true);
      confirmTimer.current = setTimeout(() => setConfirmStart(false), 3000);
    }
  };

  return (
    <div className="mb-3 flex flex-col gap-1">
      <button
        onClick={isOnBreak ? onBreakEnd : handleStartClick}
        className={cn(
          "w-full text-xs font-medium py-2 min-h-[36px] rounded-lg border transition-colors flex items-center justify-center gap-1 hover-elevate active-elevate-2",
          isOnBreak
            ? "border-amber-400/50 bg-amber-400/15 text-amber-200"
            : confirmStart
              ? "border-amber-400/70 bg-amber-400/20 text-amber-100 ring-1 ring-amber-400/50"
              : "border-amber-400/30 bg-amber-400/10 text-amber-200/90"
        )}
      >
        {isOnBreak ? `☕ ${elapsed}m · I'm back` : confirmStart ? "Start break? Tap again" : "☕ Take break"}
      </button>
      {!isOnBreak && (
        <div className="flex gap-1">
          <button
            onClick={onLogSick}
            className="flex-1 text-[10px] font-medium rounded-lg border border-rose-400/30 bg-rose-400/10 text-rose-200/90 px-2 py-1.5 hover-elevate active-elevate-2 transition-colors"
          >
            🤒 Sick
          </button>
          <button
            onClick={onLogVacation}
            className="flex-1 text-[10px] font-medium rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-200/90 px-2 py-1.5 hover-elevate active-elevate-2 transition-colors"
          >
            🏖️ Vacation
          </button>
        </div>
      )}
    </div>
  );
}
