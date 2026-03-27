import { createContext, useContext, useState, useCallback, useMemo } from "react";

type StatusState = { working: boolean };

const StatusContext = createContext<{
  status: StatusState;
  setWorking: (v: boolean) => void;
}>({
  status: { working: false },
  setWorking: () => {},
});

export function StatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<StatusState>({ working: false });
  const setWorking = useCallback((v: boolean) => setStatus({ working: v }), []);
  const value = useMemo(() => ({ status, setWorking }), [status, setWorking]);
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}

export function useStatus() {
  return useContext(StatusContext);
}
