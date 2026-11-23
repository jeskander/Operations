"use client";

import { useEffect, useRef, useState } from "react";

/** Longest single recording; keeps the upload under the server's size limit. */
const MAX_MS = 15 * 60_000;

function pickType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

/**
 * Records from the microphone, then sends the audio to the server to be transcribed by an AI
 * speech model. The audio is never kept: only the text comes back.
 */
export function useRecorder(onText: (text: string) => void, currentId: string | null) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    setSupported(typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
    return () => {
      if (rec.current?.state === "recording") rec.current.stop();
    };
  }, []);

  const start = async () => {
    if (rec.current) return;
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError("Microphone blocked. Allow it in the browser's settings.");
      return;
    }
    const mimeType = pickType();
    const r = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      rec.current = null;
      const blob = new Blob(chunks, { type: r.mimeType || mimeType || "audio/webm" });
      if (!blob.size) return setState("idle");
      setState("transcribing");
      try {
        const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
        const form = new FormData();
        form.append("audio", blob, `dictation.${ext}`);
        if (currentId) form.append("currentId", currentId);
        const res = await fetch("/api/transcribe", { method: "POST", body: form, cache: "no-store" });
        const body = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
        if (!res.ok || !body?.text) throw new Error(body?.error ?? "Couldn't transcribe that");
        onTextRef.current(body.text.trim());
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setState("idle");
      }
    };
    r.start(1000);
    rec.current = r;
    setElapsed(0);
    setState("recording");
    timer.current = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(Math.floor(ms / 1000));
      if (ms > MAX_MS && rec.current?.state === "recording") rec.current.stop();
    }, 500);
  };

  const stop = () => {
    if (rec.current?.state === "recording") rec.current.stop();
  };

  return { supported, state, error, elapsed, start, stop };
}
