import { useMemo, useState } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import Dashboard from "./pages/Dashboard";
import Profiles from "./pages/Profiles";
import ActivityLog from "./pages/ActivityLog";
import NotFound from "./pages/not-found";
import Sidebar from "./components/Sidebar";
import { AdminProvider } from "@/hooks/use-admin-mode";
import { DragScrollProvider } from "@/hooks/use-drag-scroll";
import { clearAdminToken, getEffectiveAdminToken, saveAdminToken } from "@/lib/adminAccess";

type AccessMode = "admin" | "view";

function AccessGate({ onSelectMode }: { onSelectMode: (mode: AccessMode) => void }) {
  const [password, setPassword] = useState("");
  const [isChecking, setIsChecking] = useState(false);

  const enterAsAdmin = async () => {
    const token = password.trim();
    if (!token) {
      toast({ title: "Enter password", description: "Type your admin password first.", variant: "destructive" });
      return;
    }

    setIsChecking(true);
    try {
      const res = await fetch("/api/admin/verify", {
        method: "GET",
        headers: {
          "x-admin-token": token,
        },
      });

      if (!res.ok) {
        toast({ title: "Wrong password", description: "Entering in view-only mode is still available.", variant: "destructive" });
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

  const enterViewOnly = () => {
    clearAdminToken();
    onSelectMode("view");
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm border border-border rounded-xl bg-card p-5 space-y-4">
        <div>
          <h1 className="text-base font-semibold">ShiftClock Access</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Enter password for admin mode, or continue in view-only mode.
          </p>
        </div>

        <Input
          type="password"
          placeholder="Admin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void enterAsAdmin();
            }
          }}
        />

        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => void enterAsAdmin()} disabled={isChecking}>
            {isChecking ? "Checking..." : "Enter"}
          </Button>
          <Button variant="outline" className="flex-1" onClick={enterViewOnly} disabled={isChecking}>
            View only
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [accessMode, setAccessMode] = useState<AccessMode | null>(() => (getEffectiveAdminToken() ? "admin" : null));

  const onSelectMode = (mode: AccessMode) => {
    setAccessMode(mode);
  };

  const appShell = useMemo(() => {
    if (accessMode == null) {
      return <AccessGate onSelectMode={onSelectMode} />;
    }

    return (
      <AdminProvider>
        <Router hook={useHashLocation}>
          <DragScrollProvider>
            <div className="flex h-screen overflow-hidden bg-background">
              <Sidebar />
              <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
                <Switch>
                  <Route path="/" component={Dashboard} />                <Route path="/activity" component={ActivityLog} />                  <Route path="/profiles" component={Profiles} />
                  <Route component={NotFound} />
                </Switch>
              </main>
            </div>
          </DragScrollProvider>
          <PerplexityAttribution />
          <Toaster />
        </Router>
      </AdminProvider>
    );
  }, [accessMode]);

  return (
    <QueryClientProvider client={queryClient}>
      {appShell}
    </QueryClientProvider>
  );
}
