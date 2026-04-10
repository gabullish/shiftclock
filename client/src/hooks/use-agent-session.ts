// Thin context hook so pages don't have to import from App.tsx.
// The context itself is still created and provided in App.tsx — this just
// gives consumers a clean import path.
import { createContext, useContext } from "react";
import type { AgentSession } from "@/lib/agentAccess";

export const AgentSessionContext = createContext<AgentSession | null>(null);
export function useAgentSession() {
  return useContext(AgentSessionContext);
}
