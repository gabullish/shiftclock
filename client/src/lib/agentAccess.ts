const AGENT_SESSION_KEY = "shiftclock-agent-session";
const AGENT_IDLE_TIMEOUT_MS = 4 * 60 * 1000; // 4 minutes

export interface AgentSession {
  agentId: number;
  agentName: string;
  token: string;
  lastActivity: number;
}

export function getAgentSession(): AgentSession | null {
  try {
    const raw = sessionStorage.getItem(AGENT_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as AgentSession;
    if (Date.now() - session.lastActivity > AGENT_IDLE_TIMEOUT_MS) {
      clearAgentSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function saveAgentSession(session: Omit<AgentSession, "lastActivity">): void {
  const full: AgentSession = { ...session, lastActivity: Date.now() };
  sessionStorage.setItem(AGENT_SESSION_KEY, JSON.stringify(full));
}

export function touchAgentSession(): void {
  const session = getAgentSession();
  if (!session) return;
  session.lastActivity = Date.now();
  sessionStorage.setItem(AGENT_SESSION_KEY, JSON.stringify(session));
}

export function clearAgentSession(): void {
  sessionStorage.removeItem(AGENT_SESSION_KEY);
}

export function getAgentToken(): string {
  return getAgentSession()?.token ?? "";
}

/** Returns request headers for agent-authenticated API calls */
export function agentAuthHeaders(): Record<string, string> {
  const token = getAgentToken();
  return token ? { "x-agent-session": token } : {};
}

/** Signs in as agent: validates password + agentId on backend, stores session */
export async function signInAsAgent(
  password: string,
  agentId: number
): Promise<AgentSession> {
  const res = await fetch("/api/auth/agent-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, agentId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { token: string; agentId: number; agentName: string };
  const session = { token: data.token, agentId: data.agentId, agentName: data.agentName };
  saveAgentSession(session);
  return { ...session, lastActivity: Date.now() };
}

/** Checks whether agent mode is configured on the server */
export async function isAgentModeAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/agent-password-configured");
    if (!res.ok) return false;
    const data = await res.json() as { configured: boolean };
    return data.configured;
  } catch {
    return false;
  }
}
