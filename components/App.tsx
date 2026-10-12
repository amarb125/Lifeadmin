"use client";

import { AppProvider, useApp } from "@/lib/app-context";
import { Home } from "./Home";
import { Login } from "./Login";

function Gate() {
  const { mode, ready, authChecked, userEmail } = useApp();
  if (mode === "supabase" && authChecked && !userEmail && !ready) return <Login />;
  if (!ready) return <div className="flex min-h-dvh items-center justify-center text-muted" role="status">Loading LifePilot…</div>;
  return <Home />;
}

export default function App() {
  return (
    <AppProvider>
      <Gate />
    </AppProvider>
  );
}
