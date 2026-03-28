import { useState, useEffect, useCallback, useRef } from "react";

export type BackendState = "connected" | "disconnected" | "checking" | "restarting";

const POLL_INTERVAL = 10_000; // 10 seconds

/** Fast single-shot health ping for dev mode (no Electron IPC). */
async function devPing(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("http://localhost:8000/health", { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

export function useBackendStatus() {
  const [state, setState] = useState<BackendState>("checking");
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const check = useCallback(async () => {
    try {
      // Use fast ping IPC in Electron, direct fetch in dev mode
      const healthy = window.foamPilot?.docker?.ping
        ? await window.foamPilot.docker.ping()
        : await devPing();
      setState(healthy ? "connected" : "disconnected");
    } catch {
      setState("disconnected");
    }
  }, []);

  const restart = useCallback(async () => {
    if (!window.foamPilot?.docker) return;
    setState("restarting");
    try {
      const result = await window.foamPilot.docker.start();
      setState(result.ok && result.healthy ? "connected" : "disconnected");
    } catch {
      setState("disconnected");
    }
  }, []);

  useEffect(() => {
    check();
    intervalRef.current = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [check]);

  // Listen for status-change events from main process
  useEffect(() => {
    if (!window.foamPilot?.docker?.onStatusChange) return;
    const unsub = window.foamPilot.docker.onStatusChange((s) => {
      if (s.container === "running") setState("connected");
      else if (s.container === "unhealthy" || s.container === "stopped" || s.container === "not_found") {
        setState("disconnected");
      }
    });
    return unsub;
  }, []);

  return { state, restart };
}
