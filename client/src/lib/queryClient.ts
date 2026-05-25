import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getEffectiveAdminToken } from "@/lib/adminAccess";
import { getAgentToken } from "@/lib/agentAccess";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {};
  const adminToken = getEffectiveAdminToken();
  const agentToken = getAgentToken();
  if (data) headers["Content-Type"] = "application/json";
  if (adminToken) headers["x-admin-token"] = adminToken;
  if (agentToken) headers["x-agent-session"] = agentToken;
  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const headers: Record<string, string> = {};
    const adminToken = getEffectiveAdminToken();
    const agentToken = getAgentToken();
    if (adminToken) headers["x-admin-token"] = adminToken;
    if (agentToken) headers["x-agent-session"] = agentToken;
    const res = await fetch(queryKey.join("/"), { headers });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 30 * 1000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

// ─── SSE live-push listener ───────────────────────────────────────────────────
// Connects to /api/events once, receives invalidation signals from the server,
// and immediately refetches the affected query keys — giving instant cross-tab sync.
let _sseSource: EventSource | null = null;

export function connectSSE() {
  if (_sseSource) return;

  const connect = () => {
    const es = new EventSource("/api/events");
    _sseSource = es;

    es.onmessage = (e) => {
      if (!e.data || e.data === "connected") return;
      try {
        const { invalidate } = JSON.parse(e.data) as { invalidate: string[] };
        for (const key of invalidate) {
          queryClient.invalidateQueries({ queryKey: [`/api/${key}`] });
        }
      } catch { /* ignore malformed frames */ }
    };

    es.onerror = () => {
      es.close();
      _sseSource = null;
      // Reconnect after 5 s — handles server restarts / Render cold starts
      setTimeout(connect, 5_000);
    };
  };

  connect();
}
