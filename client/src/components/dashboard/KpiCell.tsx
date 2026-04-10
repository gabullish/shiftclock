// Single KPI stat cell — label on top, bold value below, optional warn/accent colouring.
import { cn } from "@/lib/utils";

export function KpiCell({ label, value, warn, accent }: {
  label: string;
  value: string;
  warn?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="p-2.5 border-r last:border-r-0 border-border text-center">
      <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
      <p className={cn(
        "text-sm font-mono font-bold tabular-nums",
        warn ? "text-red-400" : accent ? "text-primary" : "text-foreground"
      )}>{value}</p>
    </div>
  );
}
