// Root application shell — auth gate, hash routing, idle timeout, and context providers.
// Three access modes: "admin" (password-only), "agent" (token + agent ID), view-only (null).
import { useCallback, useEffect, useRef, useState } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { Toaster } from "@/components/ui/toaster";
import { AppFooter } from "@/components/AppFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import Dashboard from "./pages/Dashboard";
import Profiles from "./pages/Profiles";
import ActivityLog from "./pages/ActivityLog";
import WorldView from "./components/world/WorldView";
import NotFound from "./pages/not-found";
import Sidebar from "./components/Sidebar";
import { AdminProvider } from "@/hooks/use-admin-mode";
import { AgentSessionContext } from "@/hooks/use-agent-session";
import { clearAdminToken, getEffectiveAdminToken, saveAdminToken } from "@/lib/adminAccess";
import {
  clearAgentSession,
  getAgentSession,
  isAgentModeAvailable,
  saveAgentSession,
  signInAsAgent,
  touchAgentSession,
  type AgentSession,
} from "@/lib/agentAccess";
import type { Agent } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";

// Re-export so legacy imports (e.g. `from "@/App"`) keep working during migration.
// TODO: remove once all consumers point to @/hooks/use-agent-session
export { AgentSessionContext, useAgentSession } from "@/hooks/use-agent-session";

const IDLE_TIMEOUT_MS = 4 * 60 * 1000;
const IDLE_EVENTS: Array<keyof WindowEventMap> = ["click", "keydown", "pointerdown", "scroll", "input"];

// Stable empty fallback — avoids new [] reference on every render while agents query is loading.
const NO_AGENTS: Agent[] = [];

type AccessMode = "admin" | "agent" | "view";

/* ── Access Gate ── */
function AccessGate({ onSelectMode }: { onSelectMode: (mode: AccessMode, session?: AgentSession) => void }) {
  const [password, setPassword] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [showAgentSelector, setShowAgentSelector] = useState(false);
  const [agentPasswordForSelector, setAgentPasswordForSelector] = useState("");
  const [agentModeAvailable, setAgentModeAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    isAgentModeAvailable().then(setAgentModeAvailable);
  }, []);

  const enterAsAdmin = async () => {
    const token = password.trim();
    if (!token) {
      toast({ title: "Enter password", description: "Type your admin password first.", variant: "destructive" });
      return;
    }
    setIsChecking(true);
    try {
      const res = await fetch("/api/admin/verify", { method: "GET", headers: { "x-admin-token": token } });
      if (!res.ok) {
        const errorBody = await res.text();
        toast({ title: "Admin login failed", description: errorBody || `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      saveAdminToken(token);
      onSelectMode("admin");
    } catch {
      toast({ title: "Login failed", description: "Network error while validating password.", variant: "destructive" });
    } finally {
      setIsChecking(false);
    }
  };

  const tryAgentPassword = async () => {
    const token = password.trim();
    if (!token) {
      toast({ title: "Enter password", description: "Type the agent password first.", variant: "destructive" });
      return;
    }
    setIsChecking(true);
    // Verify the agent password against a known agentId=0 probe (server only checks password field)
    try {
      const res = await fetch("/api/auth/agent-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: token, agentId: -1 }), // invalid agentId → 404 but 401 = wrong password
      });
      if (res.status === 401) {
        toast({ title: "Wrong password", description: "Check the agent password and try again.", variant: "destructive" });
        setIsChecking(false);
        return;
      }
      // status 404 = password OK, agent not found → which is fine, open selector
      setAgentPasswordForSelector(token);
      setShowAgentSelector(true);
    } catch {
      toast({ title: "Login failed", description: "Network error.", variant: "destructive" });
    } finally {
      setIsChecking(false);
    }
  };

  const enterViewOnly = () => {
    clearAdminToken();
    onSelectMode("view");
  };

  if (showAgentSelector) {
    return (
      <AgentSelectorPopup
        agentPassword={agentPasswordForSelector}
        onSelected={(session) => onSelectMode("agent", session)}
        onBack={() => setShowAgentSelector(false)}
      />
    );
  }

  return (
    <div className="h-dvh w-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm border border-border rounded-xl bg-card p-5 space-y-4">
        <div>
          <h1 className="text-base font-semibold">ShiftClock Access</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Enter manager or agent password, or continue in view-only mode.
          </p>
        </div>

        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void enterAsAdmin(); }}
        />

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => void enterAsAdmin()} disabled={isChecking}>
              {isChecking ? "Checking…" : "Manager"}
            </Button>
            {agentModeAvailable && (
              <Button variant="secondary" className="flex-1" onClick={() => void tryAgentPassword()} disabled={isChecking}>
                Agent
              </Button>
            )}
          </div>
          <Button variant="outline" className="w-full" onClick={enterViewOnly} disabled={isChecking}>
            View only
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Agent Selector Popup ── */
function AgentSelectorPopup({
  agentPassword,
  onSelected,
  onBack,
}: {
  agentPassword: string;
  onSelected: (session: AgentSession) => void;
  onBack: () => void;
}) {
  const { data: agents = [] } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });
  const [isLoading, setIsLoading] = useState(false);

  const selectAgent = async (agent: Agent) => {
    setIsLoading(true);
    try {
      const session = await signInAsAgent(agentPassword, agent.id);
      onSelected(session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      toast({ title: "Agent login failed", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-dvh w-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm border border-border rounded-xl bg-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground text-xs">← Back</button>
          <div>
            <h1 className="text-base font-semibold">Who are you?</h1>
          </div>
        </div>
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {agents.map((agent) => (
            <button
              key={agent.id}
              disabled={isLoading}
              onClick={() => void selectAgent(agent)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-accent transition-colors text-left disabled:opacity-50"
            >
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: agent.color }} />
              <div>
                <p className="text-sm font-medium">{agent.name}</p>
                <p className="text-xs text-muted-foreground">{agent.role}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Main App ── */
export default function App() {
  const [accessMode, setAccessMode] = useState<AccessMode | null>(() => (getEffectiveAdminToken() ? "admin" : null));
  const [agentSession, setAgentSession] = useState<AgentSession | null>(() => getAgentSession());
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: agentsForStatus = NO_AGENTS } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    refetchInterval: 30_000,
    staleTime: Infinity,
    enabled: accessMode !== null,
  });
  const isOnBreak = agentsForStatus.find(a => a.id === agentSession?.agentId)?.breakActiveAt != null;

  // Restore existing agent session on mount
  useEffect(() => {
    const existing = getAgentSession();
    if (existing && !accessMode) {
      setAgentSession(existing);
      setAccessMode("agent");
    }
  }, []);

  // Backward compatibility: convert old hash deeplinks like #/overtime?... to ?...#/overtime
  useEffect(() => {
    const hash = window.location.hash || "";
    const overtimePrefix = "#/overtime?";
    if (!hash.startsWith(overtimePrefix)) return;

    const query = hash.slice(overtimePrefix.length);
    const next = `${window.location.pathname}${query ? `?${query}` : ""}#/overtime`;
    window.history.replaceState(null, "", next);
  }, []);

  // Idle timeout for agent mode — every user interaction resets a 4-minute countdown.
  // When the timer fires, the session is cleared in both sessionStorage and React state,
  // dropping the user back to view-only. We also touch sessionStorage on each activity
  // so that tabs opened in the background don't silently expire while the user is active
  // in another tab (both tabs share sessionStorage and both reset the lastActivity stamp).
  const resetIdle = useCallback(() => {
    if (accessMode !== "agent") return;
    touchAgentSession();
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      clearAgentSession();
      setAgentSession(null);
      setAccessMode(null);
      toast({ title: "Session expired", description: "Agent session timed out due to inactivity." });
    }, IDLE_TIMEOUT_MS);
  }, [accessMode]);

  useEffect(() => {
    if (accessMode !== "agent") return;
    resetIdle();
    const handler = () => resetIdle();
    IDLE_EVENTS.forEach((ev) => window.addEventListener(ev, handler, { passive: true }));
    return () => {
      IDLE_EVENTS.forEach((ev) => window.removeEventListener(ev, handler));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [accessMode, resetIdle]);

  const onSelectMode = useCallback((mode: AccessMode, session?: AgentSession) => {
    setAccessMode(mode);
    if (mode === "agent" && session) {
      setAgentSession(session);
      saveAgentSession(session);
    } else {
      setAgentSession(null);
    }
  }, []);

  if (accessMode == null) {
    return (
      <>
        <AccessGate onSelectMode={onSelectMode} />
        <Toaster />
      </>
    );
  }

  return (
    <AgentSessionContext.Provider value={agentSession}>
      <AdminProvider>
        <Router hook={useHashLocation}>
          <div className="flex h-dvh overflow-hidden bg-background">
            <Sidebar
              agentSession={agentSession}
              isOnBreak={isOnBreak}
              onAgentSignOff={() => {
                clearAgentSession();
                setAgentSession(null);
                setAccessMode(null);
              }}
            />
            <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
              <Switch>
                <Route path="/" component={Dashboard} />
                <Route path="/activity" component={ActivityLog} />
                <Route path="/overtime" component={ActivityLog} />
                <Route path="/profiles" component={Profiles} />
                <Route path="/world" component={WorldView} />
                <Route component={NotFound} />
              </Switch>
            </main>
          </div>
          <AppFooter />
        </Router>
      </AdminProvider>
      <Toaster />
    </AgentSessionContext.Provider>
  );
}
