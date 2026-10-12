"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { useApp } from "@/lib/app-context";

export function Login() {
  const { signInGoogle, signInEmail } = useApp();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [err, setErr] = useState<string | null>(null);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <h1 className="font-display text-5xl leading-tight">LifePilot</h1>
      <p className="mt-3 text-lg text-muted">Say what needs doing. I'll plan it, remind you, and check in.</p>

      <button className="btn-ghost mt-8 w-full py-3" onClick={async () => setErr(await signInGoogle())}>Continue with Google</button>
      <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>

      {state === "sent" ? (
        <p role="status" className="card p-4">Check <strong>{email}</strong> for a sign-in link. You can close this tab.</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setState("sending");
            const m = await signInEmail(email.trim());
            setErr(m);
            setState(m ? "idle" : "sent");
          }}
        >
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" className="field" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn-primary w-full py-3" disabled={state === "sending"}>{state === "sending" ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />} Email me a sign-in link</button>
        </form>
      )}
      {err && <p role="alert" className="mt-3 text-sm text-warn">{err}</p>}
    </main>
  );
}
