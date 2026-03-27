import { useState, useEffect, useRef, useCallback } from "react";

export function useStopwatch() {
  const [elapsed, setElapsed] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const startTimeRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const tick = useCallback(() => {
    setElapsed(Date.now() - startTimeRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(() => {
    startTimeRef.current = Date.now();
    setElapsed(0);
    setIsRunning(true);
  }, []);

  const stop = useCallback(() => {
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    setIsRunning(false);
    setElapsed(0);
  }, []);

  useEffect(() => {
    if (isRunning) {
      rafRef.current = requestAnimationFrame(tick);
    } else if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isRunning, tick]);

  return { elapsed, isRunning, start, stop, reset };
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
