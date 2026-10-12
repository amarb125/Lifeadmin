"use client";

import { useRef, useState } from "react";
import { Loader2, Mic, Sparkles, Square } from "lucide-react";
import clsx from "clsx";

/* eslint-disable @typescript-eslint/no-explicit-any */
const EXAMPLES = [
  "Buy groceries tomorrow evening, pay the electricity bill before Wednesday and submit the document by Friday at 5 PM",
  "Remind me to pay rent on the first of every month",
  "Finish my presentation by tomorrow at 4 PM. I can only work on it after 7 PM today.",
];

type Mode = "idle" | "listening" | "recording" | "transcribing";

export function Capture({ onSubmit, busy }: { onSubmit: (text: string) => void; busy: boolean }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const textRef = useRef("");
  const recRef = useRef<any>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const errored = useRef(false);

  const setBoth = (v: string) => {
    textRef.current = v;
    setText(v);
  };

  const SR: any = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;

  async function startRecorder() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setMode("transcribing");
        const type = mr.mimeType || "audio/webm";
        const fd = new FormData();
        fd.append("audio", new Blob(chunks.current, { type }), `voice.${type.includes("mp4") ? "mp4" : "webm"}`);
        try {
          const res = await fetch("/api/transcribe", { method: "POST", body: fd });
          if (res.status === 501) setMsg("Voice fallback isn't set up on this server (it needs an OpenAI key). Please type, or use Chrome, Edge or Safari, which transcribe in the browser.");
          else if (!res.ok) setMsg("Transcription failed. Please type your request instead.");
          else {
            const j = await res.json();
            if (j.text) {
              const merged = (textRef.current ? textRef.current + " " : "") + j.text;
              setBoth(merged);
              onSubmit(merged);
            } else setMsg("I couldn't make out any speech. Try again.");
          }
        } catch {
          setMsg("Couldn't reach the transcription service. Please type instead.");
        }
        setMode("idle");
      };
      mr.start();
      mediaRef.current = mr;
      setMode("recording");
    } catch {
      setMsg("I can't access your microphone. Allow it in your browser's site settings, or type instead.");
      setMode("idle");
    }
  }

  function startSpeech() {
    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    const base = textRef.current ? textRef.current.trim() + " " : "";
    errored.current = false;
    rec.onresult = (e: any) => {
      let fin = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript;
        else interim += r[0].transcript;
      }
      setBoth(base + fin + interim);
    };
    rec.onerror = (e: any) => {
      errored.current = true;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setMsg("Microphone permission was denied. Allow it in your browser's site settings, or type instead.");
      else if (e.error === "no-speech") setMsg("I didn't hear anything. Tap the mic and try again.");
      else if (e.error === "aborted") errored.current = false;
      else {
        setMsg("Browser speech recognition isn't working here — switching to recorded audio.");
        startRecorder();
        return;
      }
      setMode("idle");
    };
    rec.onend = () => {
      setMode((m) => (m === "listening" ? "idle" : m));
      if (!errored.current && textRef.current.trim()) onSubmit(textRef.current.trim());
    };
    recRef.current = rec;
    setMsg(null);
    try {
      rec.start();
      setMode("listening");
    } catch {
      startRecorder();
    }
  }

  function toggleMic() {
    if (mode === "listening") return recRef.current?.stop();
    if (mode === "recording") return mediaRef.current?.stop();
    if (mode !== "idle" || busy) return;
    setMsg(null);
    if (SR) startSpeech();
    else if (typeof MediaRecorder !== "undefined" && navigator.mediaDevices) startRecorder();
    else setMsg("Voice input isn't supported in this browser. Please type instead.");
  }

  const active = mode === "listening" || mode === "recording";
  const label = mode === "listening" ? "Listening… tap to finish" : mode === "recording" ? "Recording… tap to finish" : mode === "transcribing" ? "Transcribing…" : "Tap and tell me what's on your plate";

  return (
    <section className="rounded-3xl bg-hero p-5 text-hero-ink shadow-lg sm:p-7" aria-label="Capture tasks">
      <div className="flex flex-col items-center text-center">
        <div className="relative my-2">
          {active && <span className="absolute inset-0 animate-pulseRing rounded-full bg-accent" />}
          <button
            onClick={toggleMic}
            disabled={busy || mode === "transcribing"}
            aria-label={active ? "Stop recording" : "Start voice input"}
            aria-pressed={active}
            className={clsx("relative flex h-24 w-24 items-center justify-center rounded-full text-accent-ink shadow-xl transition active:scale-95 disabled:opacity-60", active ? "bg-warn" : "bg-accent")}
          >
            {mode === "transcribing" ? <Loader2 size={34} className="animate-spin" /> : active ? <Square size={30} fill="currentColor" /> : <Mic size={36} />}
          </button>
        </div>
        <p className="mt-3 font-display text-xl" aria-live="polite">{label}</p>
      </div>

      <div className="mt-4">
        <label htmlFor="capture" className="sr-only">Describe what you need to do</label>
        <textarea
          id="capture"
          value={text}
          onChange={(e) => setBoth(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) onSubmit(text.trim());
          }}
          rows={3}
          placeholder='…or type it: "Pay rent on the 1st of every month"'
          className="w-full resize-none rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-[15px] text-hero-ink placeholder:text-hero-ink/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        {msg && <p role="alert" className="mt-2 text-sm text-gold">{msg}</p>}
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex, i) => (
              <button key={i} onClick={() => setBoth(ex)} className="rounded-full border border-white/20 px-2.5 py-1 text-xs text-hero-ink/80 hover:bg-white/10">
                Try example {i + 1}
              </button>
            ))}
          </div>
          <button onClick={() => text.trim() && onSubmit(text.trim())} disabled={!text.trim() || busy} className="btn-primary shrink-0">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Plan it
          </button>
        </div>
      </div>
    </section>
  );
}
