import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import Dashboard from "./pages/Dashboard";
import Profiles from "./pages/Profiles";
import ActivityLog from "./pages/ActivityLog";
import NotFound from "./pages/not-found";
import Sidebar from "./components/Sidebar";
import { AdminProvider } from "@/hooks/use-admin-mode";
import { DragScrollProvider } from "@/hooks/use-drag-scroll";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  );
}
