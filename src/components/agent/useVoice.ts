"use client";
import { useCallback, useEffect, useRef, useState } from "react";
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: { isFinal: boolean; 0: { transcript: string } }[];
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
  stop: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
export function useVoice(onText: (text: string) => void, lang: string) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const callback = useRef(onText);
  callback.current = onText;
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silence = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);
  const stop = useCallback(() => {
    cancelled.current = true;
    recognition.current?.abort();
    recognition.current = null;
    if (timer.current) clearTimeout(timer.current);
    setListening(false);
    silence();
  }, [silence]);
  useEffect(() => {
    const w = window as SpeechWindow;
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => {
      cancelled.current = true;
      recognition.current?.abort();
      window.speechSynthesis?.cancel();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const listen = () => {
    if (listening) {
      stop();
      return;
    }
    silence();
    setError("");
    cancelled.current = false;
    const C =
      (window as SpeechWindow).SpeechRecognition ||
      (window as SpeechWindow).webkitSpeechRecognition;
    if (!C) return;
    const r = new C();
    let transcript = "";
    recognition.current = r;
    r.lang = lang === "en" ? "en-US" : "es-US";
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e) => {
      transcript = Array.from(e.results)
        .filter((x) => x.isFinal)
        .map((x) => x[0].transcript)
        .join(" ");
    };
    r.onerror = (e) => {
      cancelled.current = true;
      setError(
        e.error === "not-allowed"
          ? "No se concedió acceso al micrófono. Puedes continuar por escrito."
          : "No pude escuchar con claridad. Prueba de nuevo o escribe.",
      );
    };
    r.onend = () => {
      setListening(false);
      recognition.current = null;
      if (timer.current) clearTimeout(timer.current);
      if (!cancelled.current && transcript.trim())
        callback.current(transcript.trim());
    };
    try {
      r.start();
      setListening(true);
      timer.current = setTimeout(() => r.stop(), 45000);
    } catch {
      setError("No se pudo abrir el micrófono.");
      setListening(false);
    }
  };
  const speak = (text: string) => {
    silence();
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text.slice(0, 3000));
    u.lang = lang === "en" ? "en-US" : "es-US";
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };
  return {
    supported,
    listening,
    speaking,
    error,
    listen,
    speak,
    silence,
    stop,
  };
}
