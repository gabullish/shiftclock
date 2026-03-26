import { createContext, useContext, useMemo } from "react";

const ADMIN_TOKEN = "shiftclock-admin-2024";

function readAdminFromUrl(): boolean {
  // Read from regular query string: ?admin=TOKEN (before the hash)
  // URL format: http://example.com/?admin=shiftclock-admin-2024#/
  // This avoids conflicting with wouter hash routing
  const params = new URLSearchParams(window.location.search);
  return params.get("admin") === ADMIN_TOKEN;
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
