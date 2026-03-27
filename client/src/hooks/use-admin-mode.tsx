import { createContext, useContext, useMemo } from "react";

function readAdminFromUrl(): boolean {
  // Read from regular query string: ?admin=TOKEN (before the hash).
  // The server validates the token value via x-admin-token.
  const params = new URLSearchParams(window.location.search);
  return Boolean(params.get("admin"));
}

export const AdminContext = createContext<boolean>(false);

export function useAdminMode(): boolean {
  return useContext(AdminContext);
}

// Provider reads once on mount (token doesn't change during session)
export function AdminProvider({ children }: { children: React.ReactNode }) {
  const isAdmin = useMemo(() => readAdminFromUrl(), []);
  return <AdminContext.Provider value={isAdmin}>{children}</AdminContext.Provider>;
}
