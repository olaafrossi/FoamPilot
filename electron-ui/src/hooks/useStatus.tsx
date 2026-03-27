import { createContext, useContext, useState, useCallback, useMemo } from "react";

type StatusState = { working: boolean; elapsed: number };

const StatusContext = createContext<{
  status: StatusState;
  setWorking: (v: boolean) => void;
  setElapsed: (ms: number) => void;
}>({
  status: { working: false, elapsed: 0 },
  setWorking: () => {},
  setElapsed: () => {},
});

export function StatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<StatusState>({ working: false, elapsed: 0 });
  const setWorking = useCallback((v: boolean) => setStatus((s) => ({ ...s, working: v })), []);
  const setElapsed = useCallback((ms: number) => setStatus((s) => ({ ...s, elapsed: ms })), []);
  const value = useMemo(() => ({ status, setWorking, setElapsed }), [status, setWorking, setElapsed]);
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}

export function useStatus() {
  return useContext(StatusContext);
}
