"use client";

import { useEffect, useRef, useState } from "react";
import { chatMascotState, type MascotState } from "@/lib/mascot/state";

const SUCCESS_MS = 1600;
const ERROR_MS = 2200;

/**
 * Darwin's pose in a chat: thinking while a reply is in flight, then a short success (or error, when the reply
 * failed) before settling back to idle.
 */
export function useChatMascot(busy: boolean, failed: boolean): MascotState {
  const [settled, setSettled] = useState<MascotState>("idle");
  const wasBusy = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      return;
    }
    if (!wasBusy.current) return;
    wasBusy.current = false;
    const next = chatMascotState({ failed, justReplied: !failed });
    timers.current.forEach(clearTimeout);
    // Deferred a tick: the reply landing is an event, not render state.
    timers.current = [setTimeout(() => setSettled(next), 0), setTimeout(() => setSettled("idle"), next === "error" ? ERROR_MS : SUCCESS_MS)];
  }, [busy, failed]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return busy ? "thinking" : settled;
}
