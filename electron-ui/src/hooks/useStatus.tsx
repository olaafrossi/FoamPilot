import { createContext, useContext, useState, useCallback, useMemo, useRef } from "react";

type StatusState = { working: boolean; elapsed: number; error: string | null };

const StatusContext = createContext<{
  status: StatusState;
  setWorking: (v: boolean) => void;
  setElapsed: (ms: number) => void;
  setError: (msg: string | null) => void;
}>({
  status: { working: false, elapsed: 0, error: null },
  setWorking: () => {},
  setElapsed: () => {},
  setError: () => {},
});

export function StatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<StatusState>({ working: false, elapsed: 0, error: null });
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setWorking = useCallback((v: boolean) => setStatus((s) => ({ ...s, working: v })), []);
  const setElapsed = useCallback((ms: number) => setStatus((s) => ({ ...s, elapsed: ms })), []);
  const setError = useCallback((msg: string | null) => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setStatus((s) => ({ ...s, error: msg }));
    if (msg) {
      errorTimerRef.current = setTimeout(() => setStatus((s) => ({ ...s, error: null })), 8000);
    }
  }, []);
  const value = useMemo(() => ({ status, setWorking, setElapsed, setError }), [status, setWorking, setElapsed, setError]);
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}

export function useStatus() {
  return useContext(StatusContext);
}
