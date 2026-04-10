// Break button for the agent's own shift card — shows elapsed break time and
// toggles between "take break" and "I'm back".
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

export function AgentBreakControl({ isOnBreak, startedAt, onBreakStart, onBreakEnd }: {
  isOnBreak: boolean;
  startedAt: number | null;
  onBreakStart: () => void;
  onBreakEnd: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 60000));
    tick();
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, [startedAt]);

  return (
    <div className="mb-3">
      <button
        onClick={isOnBreak ? onBreakEnd : onBreakStart}
        className={cn(
          "w-full text-xs py-2 min-h-[36px] rounded border transition-colors flex items-center justify-center gap-1",
          isOnBreak
            ? "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
            : "border-border text-muted-foreground hover:text-foreground"
        )}
      >
        {isOnBreak ? `☕ ${elapsed}m · I'm back` : "☕ Take break"}
      </button>
    </div>
  );
}
