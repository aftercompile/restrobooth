"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 5_000; // ADR-0005 §3: the Booth polls, it never holds a socket.

/**
 * Renders nothing — just drives the live status board's refresh.
 * Foreground-gated via the Page Visibility API (ADR-0005 §3: "5 s while
 * foregrounded, stopping entirely when backgrounded") — net-new to this
 * codebase; no existing poll (KDS's fallback, the floor map's backstop)
 * gates on visibility, only on navigator.onLine. A guest who's put their
 * phone in their pocket mid-meal shouldn't burn battery/data polling.
 */
export function BoothPoll() {
  const router = useRouter();

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;

    function start() {
      if (id !== null) return;
      id = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    }
    function stop() {
      if (id === null) return;
      clearInterval(id);
      id = null;
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        router.refresh(); // catch up immediately, don't wait for the next tick
        start();
      } else {
        stop();
      }
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  return null;
}
