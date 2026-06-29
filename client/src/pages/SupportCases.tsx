import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { LifeBuoy, Search, ExternalLink, RefreshCw, Clock, ChevronRight, X, Construction } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getEffectiveAdminToken } from "@/lib/adminAccess";
import { getAgentSession } from "@/lib/agentAccess";

interface SupportCase {
  dateTime: string;
  caseId: string;
  agentName: string;
  category: string;
  status: string;
  message: string;
  channel: string;
  threadLink: string;
  intercomLink: string;
  note: string;
}

interface ApiResponse {
  cases: SupportCase[];
  fetchedAt: number;
  stale?: boolean;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const adminToken = getEffectiveAdminToken();
  if (adminToken) headers["x-admin-token"] = adminToken;
  const session = getAgentSession();
  if (session) headers["x-agent-session"] = session.token;
  return headers;
}

function agentColor(name: string): string {
  const colors = [
    "#f59e0b", "#3b82f6", "#10b981", "#f43f5e",
    "#8b5cf6", "#06b6d4", "#84cc16", "#f97316",
    "#ec4899", "#6366f1",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return colors[h % colors.length];
}

function initials(name: string): string {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function formatDate(iso: string): string {
  try {
    return format(parseISO(iso), "MMM d, HH:mm");
  } catch {
    return iso;
  }
}

function formatDateLong(iso: string): string {
  try {
    return format(parseISO(iso), "MMM d, yyyy · HH:mm 'UTC'");
  } catch {
    return iso;
  }
}

function channelLabel(channel: string): string {
  return channel
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function StatusBadge({ status }: { status: string }) {
  const isOpen = status.toLowerCase() === "open";
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase",
      isOpen
        ? "bg-amber-400/15 text-amber-400 border border-amber-400/30"
        : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
    )}>
      <span className={cn("w-1.5 h-1.5 rounded-full", isOpen ? "bg-amber-400" : "bg-emerald-400")} />
      {status}
    </span>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border/60 truncate max-w-[160px]" title={channelLabel(channel)}>
      #{channelLabel(channel)}
    </span>
  );
}

function CaseCard({ c, onClick }: { c: SupportCase; onClick: () => void }) {
  const color = agentColor(c.agentName);
  const preview = c.message.replace(/\n+/g, " ").slice(0, 120) + (c.message.length > 120 ? "…" : "");

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border border-border bg-card hover:bg-accent/40 hover:border-border/80 transition-all duration-150 p-4 group"
    >
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs font-bold text-primary/80 shrink-0">{c.caseId}</span>
          <StatusBadge status={c.status} />
        </div>
        <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-muted-foreground">
          <Clock size={10} />
          {formatDate(c.dateTime)}
        </div>
      </div>

      <p className="text-sm font-semibold text-foreground mb-1.5 leading-tight">{c.category}</p>

      <div className="flex items-center gap-2 mb-3">
        <span
          className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {initials(c.agentName)}
        </span>
        <span className="text-xs text-muted-foreground truncate">{c.agentName}</span>
      </div>

      {preview && (
        <p className="text-xs text-muted-foreground/80 leading-relaxed mb-3 line-clamp-2">{preview}</p>
      )}

      <div className="flex items-center justify-between">
        {c.channel && <ChannelBadge channel={c.channel} />}
        <ChevronRight size={14} className="text-muted-foreground/50 group-hover:text-muted-foreground ml-auto transition-colors" />
      </div>
    </button>
  );
}

function CaseDetail({ c, onClose }: { c: SupportCase; onClose: () => void }) {
  const color = agentColor(c.agentName);

  return (
    <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
      <DialogHeader className="shrink-0">
        <div className="flex items-center gap-3 mb-1">
          <span className="font-mono text-sm font-bold text-primary/80">{c.caseId}</span>
          <StatusBadge status={c.status} />
        </div>
        <DialogTitle className="text-base leading-snug">{c.category}</DialogTitle>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto space-y-5 pr-1">
        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
              style={{ backgroundColor: color }}
            >
              {initials(c.agentName)}
            </span>
            <span className="text-foreground font-medium">{c.agentName}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock size={11} />
            {formatDateLong(c.dateTime)}
          </div>
          {c.channel && <ChannelBadge channel={c.channel} />}
        </div>

        {/* Case description */}
        {c.message && (
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Description</p>
            <div className="bg-muted/40 rounded-md p-3 text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap border border-border/50">
              {c.message}
            </div>
          </div>
        )}

        {/* Note */}
        {c.note && (
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Note</p>
            <div className="bg-muted/40 rounded-md p-3 text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap border border-border/50">
              {c.note}
            </div>
          </div>
        )}

        {/* Links */}
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Links</p>
          <div className="flex flex-wrap gap-2">
            {c.threadLink && c.threadLink !== "Open Thread" && (
              <a
                href={c.threadLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition-colors"
              >
                <ExternalLink size={11} />
                Slack Thread
              </a>
            )}
            {c.intercomLink && c.intercomLink !== "Open Intercom" && (
              <a
                href={c.intercomLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 transition-colors"
              >
                <ExternalLink size={11} />
                Intercom
              </a>
            )}
          </div>
        </div>

        {/* Status update — coming soon */}
        <div className="relative rounded-lg border border-dashed border-border/60 p-4 bg-muted/20 overflow-hidden">
          <div className="flex items-start gap-3">
            <Construction size={16} className="text-muted-foreground/60 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-foreground/80 mb-0.5">Update Status</p>
              <p className="text-xs text-muted-foreground/70 leading-relaxed">
                Changing case status from here will sync back to the Google Sheet once write access is configured.
              </p>
              <span className="mt-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20 tracking-wide uppercase">
                Coming Soon
              </span>
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  );
}

const STATUS_TABS = ["All", "Open", "Resolved"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

export default function SupportCases() {
  const [statusTab, setStatusTab] = useState<StatusTab>("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SupportCase | null>(null);

  const { data, isLoading, isError, error, dataUpdatedAt, refetch, isFetching } = useQuery<ApiResponse>({
    queryKey: ["/api/support-cases"],
    queryFn: async () => {
      const res = await fetch("/api/support-cases", { headers: authHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to load support cases");
      }
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 55_000,
  });

  const cases = data?.cases ?? [];

  const counts = useMemo(() => ({
    All: cases.length,
    Open: cases.filter(c => c.status.toLowerCase() === "open").length,
    Resolved: cases.filter(c => c.status.toLowerCase() === "resolved").length,
  }), [cases]);

  const filtered = useMemo(() => {
    let list = cases;
    if (statusTab !== "All") {
      list = list.filter(c => c.status.toLowerCase() === statusTab.toLowerCase());
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(c =>
        c.caseId.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.agentName.toLowerCase().includes(q) ||
        c.message.toLowerCase().includes(q) ||
        c.channel.toLowerCase().includes(q)
      );
    }
    return list;
  }, [cases, statusTab, search]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4 lg:px-6 border-b border-border bg-card/50 backdrop-blur">
        <div className="flex items-center gap-3">
          <LifeBuoy size={16} className="text-primary shrink-0" />
          <h1 className="text-sm font-semibold text-foreground">Support Cases</h1>
          {data?.stale && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400 border border-amber-400/20 font-medium">
              cached
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {dataUpdatedAt > 0 && (
            <span className="text-[11px] text-muted-foreground hidden sm:block">
              Updated {format(new Date(dataUpdatedAt), "HH:mm:ss")}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-7 px-2 text-xs gap-1.5"
          >
            <RefreshCw size={11} className={cn(isFetching && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </header>

      {/* Coming soon banner */}
      <div className="shrink-0 mx-3 mt-3 sm:mx-4 lg:mx-6 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 flex items-center gap-3">
        <Construction size={14} className="text-primary/70 shrink-0" />
        <p className="text-xs text-foreground/70 leading-relaxed">
          <span className="font-semibold text-primary">Coming soon:</span> Status updates from this page will sync directly to the Google Sheet once write permissions are configured.
        </p>
      </div>

      {/* Filter bar */}
      <div className="shrink-0 px-3 pt-3 pb-2 sm:px-4 lg:px-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
          {STATUS_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setStatusTab(tab)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150",
                statusTab === tab
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab}
              <span className={cn(
                "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold",
                statusTab === tab ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
              )}>
                {counts[tab]}
              </span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search cases, agents…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-7 h-8 text-xs bg-muted/40"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 sm:px-4 lg:px-6">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
            <RefreshCw size={20} className="animate-spin text-primary/60" />
            <p className="text-sm">Loading support cases…</p>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <LifeBuoy size={28} className="text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">Couldn't load cases</p>
            <p className="text-xs text-muted-foreground text-center max-w-sm">
              {(error as Error)?.message ?? "Unknown error"}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-1">
              Try again
            </Button>
          </div>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <LifeBuoy size={28} className="text-muted-foreground/30" />
            <p className="text-sm">{search ? "No cases match your search" : "No cases found"}</p>
          </div>
        )}

        {!isLoading && !isError && filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pt-1">
            {filtered.map(c => (
              <CaseCard key={c.caseId} c={c} onClick={() => setSelected(c)} />
            ))}
          </div>
        )}
      </div>

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        {selected && <CaseDetail c={selected} onClose={() => setSelected(null)} />}
      </Dialog>
    </div>
  );
}
