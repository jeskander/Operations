"use client";

import { useEffect, useRef, useState } from "react";

// Minimal Web Speech API surface; not yet in TypeScript's DOM lib.
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** Browser dictation. Calls onFinal with each finished phrase. */
export function useDictation(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const rec = useRef<Recognition | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => {
    setSupported(!!getCtor());
    return () => rec.current?.stop();
  }, []);

  const start = () => {
    const Ctor = getCtor();
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    r.lang = "en-GB";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) onFinalRef.current(res[0].transcript.trim());
        else pending += res[0].transcript;
      }
      setInterim(pending);
    };
    r.onend = r.onerror = () => {
      rec.current = null;
      setListening(false);
      setInterim("");
    };
    rec.current = r;
    r.start();
    setListening(true);
  };

  const stop = () => rec.current?.stop();

  return { supported, listening, interim, start, stop };
}
