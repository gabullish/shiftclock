import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import Dashboard from "./pages/Dashboard";
import Profiles from "./pages/Profiles";
import NotFound from "./pages/not-found";
import Sidebar from "./components/Sidebar";
import { AdminProvider } from "@/hooks/use-admin-mode";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AdminProvider>
        <Router hook={useHashLocation}>
          <div className="flex h-screen overflow-hidden bg-background">
            <Sidebar />
            <main className="flex-1 overflow-hidden">
              <Switch>
                <Route path="/" component={Dashboard} />
                <Route path="/profiles" component={Profiles} />
                <Route component={NotFound} />
              </Switch>
            </main>
          </div>
          <PerplexityAttribution />
          <Toaster />
        </Router>
      </AdminProvider>
    </QueryClientProvider>
  );
}
