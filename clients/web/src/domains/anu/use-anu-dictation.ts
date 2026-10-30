/**
 * Speaking instead of typing, where the platform can turn speech into text
 * (the Web Speech API in Chrome, Safari and the WebViews built on them).
 * The microphone permission is asked only when the person taps the mic, and
 * a refusal is reported so the screen can say how to turn it back on.
 * Where the API is missing the mic is simply not offered.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { currentLocale } from "@/i18n";

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type RecognitionConstructor = new () => RecognitionLike;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function useAnuDictation(onText: (text: string) => void): {
  supported: boolean;
  listening: boolean;
  denied: boolean;
  toggle: () => void;
} {
  const [listening, setListening] = useState(false);
  const [denied, setDenied] = useState(false);
  const recognition = useRef<RecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  const Recognition = recognitionConstructor();

  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  useEffect(() => () => recognition.current?.stop(), []);

  const toggle = useCallback(() => {
    if (!Recognition) {
      return;
    }
    if (recognition.current) {
      recognition.current.stop();
      return;
    }
    const instance = new Recognition();
    instance.lang = currentLocale().startsWith("ar") ? "ar" : "en-US";
    instance.interimResults = false;
    instance.continuous = false;
    instance.onresult = (event) => {
      const parts: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.[0]?.transcript;
        if (result?.isFinal && text) {
          parts.push(text.trim());
        }
      }
      if (parts.length) {
        onTextRef.current(parts.join(" "));
      }
    };
    instance.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setDenied(true);
      }
    };
    instance.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    recognition.current = instance;
    setDenied(false);
    setListening(true);
    try {
      instance.start();
    } catch {
      recognition.current = null;
      setListening(false);
    }
  }, [Recognition]);

  return { supported: Recognition !== null, listening, denied, toggle };
}
