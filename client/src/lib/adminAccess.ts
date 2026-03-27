const ADMIN_TOKEN_STORAGE_KEY = "shiftclock-admin-token";

function readAdminTokenFromQuery(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("admin") || "";
}

export function getStoredAdminToken(): string {
  return sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || "";
}

export function getEffectiveAdminToken(): string {
  return getStoredAdminToken() || readAdminTokenFromQuery();
}

export function saveAdminToken(token: string): void {
  sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
}

export function clearAdminToken(): void {
  sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
}
