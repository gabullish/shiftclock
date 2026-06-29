import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * A single global banner that watches the React Query cache for failed data
 * fetches. Previously a down/erroring backend made every page silently render
 * "empty" (data defaults to []), which is indistinguishable from "no data".
 * This surfaces the real problem and offers a one-click retry, without each
 * page having to handle isError itself.
 */
export function ConnectionBanner() {
  const queryClient = useQueryClient();
  const [errorCount, setErrorCount] = useState(0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const recount = () => {
      const errored = cache
        .getAll()
        .filter(q => q.state.status === "error" && q.getObserversCount() > 0);
      setErrorCount(errored.length);
    };
    recount();
    const unsub = cache.subscribe(recount);
    return () => unsub();
  }, [queryClient]);

  if (errorCount === 0) return null;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await queryClient.refetchQueries({ type: "all" });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="flex items-center justify-center gap-2 bg-destructive/90 px-3 py-1.5 text-[12px] font-medium text-destructive-foreground shrink-0">
      <AlertTriangle size={13} className="shrink-0" />
      <span>Can't reach the server — showing the last data we had.</span>
      <button
        onClick={handleRetry}
        disabled={retrying}
        className="ml-1 inline-flex items-center gap-1 rounded bg-black/20 px-2 py-0.5 hover:bg-black/30 transition-colors disabled:opacity-60"
      >
        <RefreshCw size={11} className={retrying ? "animate-spin" : ""} />
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
