import { useState, useEffect, useCallback, useRef } from "react";

export type BackendState = "connected" | "disconnected" | "checking" | "restarting";

const POLL_INTERVAL = 10_000; // 10 seconds

export function useBackendStatus() {
  const [state, setState] = useState<BackendState>("checking");
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const check = useCallback(async () => {
    if (!window.foamPilot?.docker) {
      // Not in Electron — assume connected (dev mode hits backend directly)
      setState("connected");
      return;
    }
    try {
      const healthy = await window.foamPilot.docker.healthCheck();
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
