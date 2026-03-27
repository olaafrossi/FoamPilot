import { useEffect, useState, useCallback } from "react";
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { Rocket, FolderOpen, LayoutDashboard, Terminal, FileText, Settings, Upload } from "lucide-react";
import { setConfig } from "./api";
import type { AppConfig } from "./types";
import { StatusProvider, useStatus } from "./hooks/useStatus";
import { formatElapsed } from "./hooks/useStopwatch";
import WizardPage from "./pages/WizardPage";
import MySimulationsPage from "./pages/MySimulationsPage";
import SettingsPage from "./pages/SettingsPage";
import SetupPage from "./pages/SetupPage";

const NAV_ITEMS = [
  { id: "wizard", icon: Rocket, label: "Wizard", path: "/wizard" },
  { id: "simulations", icon: FolderOpen, label: "My Simulations", path: "/simulations" },
  { id: "dashboard", icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { id: "logs", icon: Terminal, label: "Logs", path: "/logs" },
  { id: "editor", icon: FileText, label: "Dict Editor", path: "/editor" },
] as const;

const SETTINGS_ITEM = { id: "settings", icon: Settings, label: "Settings", path: "/settings" } as const;

/** FP monogram logo — industrial amber branding */
function FPLogo({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="FoamPilot"
      className="flex items-center justify-center shrink-0 transition-shadow duration-200"
      style={{
        width: 48,
        height: 48,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        borderBottom: "1px solid var(--border)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow =
          "0 0 12px rgba(245, 158, 11, 0.3)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
      }}
    >
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <text
          x="14"
          y="20"
          textAnchor="middle"
          fontFamily="Satoshi, Segoe UI, system-ui, sans-serif"
          fontWeight="900"
          fontSize="18"
          fill="#F59E0B"
          letterSpacing="-0.5"
        >
          FP
        </text>
      </svg>
    </button>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { status } = useStatus();
  const [globalDragOver, setGlobalDragOver] = useState(false);

  const handleGlobalDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Only show overlay for files
    if (e.dataTransfer.types.includes("Files")) {
      setGlobalDragOver(true);
    }
  }, []);

  const handleGlobalDragLeave = useCallback((e: React.DragEvent) => {
    // Only hide when leaving the window (relatedTarget is null)
    if (!e.relatedTarget) {
      setGlobalDragOver(false);
    }
  }, []);

  const handleGlobalDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setGlobalDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].name.toLowerCase().endsWith(".stl")) {
      // Navigate to wizard — the GeometryStep will handle the file via its own drop zone
      navigate("/wizard");
    }
  }, [navigate]);

  const activeId = [...NAV_ITEMS, SETTINGS_ITEM].find(
    (item) => location.pathname.startsWith(item.path),
  )?.id ?? "wizard";

  const sideBarTitle = (() => {
    switch (activeId) {
      case "wizard": return "EXPLORER";
      case "simulations": return "SIMULATIONS";
      case "dashboard": return "DASHBOARD";
      case "logs": return "OUTPUT";
      case "editor": return "EDITOR";
      case "settings": return "SETTINGS";
      default: return "EXPLORER";
    }
  })();

  return (
    <div
      className="flex flex-col h-screen w-screen relative"
      style={{ fontFamily: "var(--font-ui)" }}
      onDragOver={handleGlobalDragOver}
      onDragLeave={handleGlobalDragLeave}
      onDrop={handleGlobalDrop}
    >
      {/* Global STL drop zone overlay */}
      {globalDragOver && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{
            background: "rgba(9, 9, 11, 0.85)",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            className="p-12 text-center border-2 border-dashed"
            style={{ borderColor: "var(--accent)", borderRadius: 8 }}
          >
            <Upload size={48} style={{ color: "var(--accent)", margin: "0 auto 16px" }} />
            <p className="text-[18px] font-semibold mb-2" style={{ color: "var(--fg)", fontFamily: "var(--font-display)" }}>
              Drop your STL here
            </p>
            <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>
              Release to start a new simulation
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Activity Bar — 48px icon strip */}
        <nav
          className="flex flex-col shrink-0"
          style={{ width: 48, background: "var(--bg-activitybar)" }}
        >
          {/* FP Logo */}
          <FPLogo onClick={() => navigate("/wizard")} />

          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeId === item.id;
            return (
              <button
                key={item.id}
                onClick={() => navigate(item.path)}
                title={item.label}
                className="relative flex items-center justify-center transition-colors duration-100"
                style={{
                  width: 48,
                  height: 48,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  borderLeft: isActive
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                  color: isActive ? "var(--fg)" : "var(--fg-muted)",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.color = "var(--fg)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.color = "var(--fg-muted)";
                }}
              >
                <Icon size={24} />
              </button>
            );
          })}

          {/* Settings at bottom */}
          <div className="mt-auto">
            {(() => {
              const Icon = SETTINGS_ITEM.icon;
              const isActive = activeId === SETTINGS_ITEM.id;
              return (
                <button
                  onClick={() => navigate(SETTINGS_ITEM.path)}
                  title={SETTINGS_ITEM.label}
                  className="relative flex items-center justify-center transition-colors duration-100"
                  style={{
                    width: 48,
                    height: 48,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    borderLeft: isActive
                      ? "2px solid var(--accent)"
                      : "2px solid transparent",
                    color: isActive ? "var(--fg)" : "var(--fg-muted)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.color = "var(--fg)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.color = "var(--fg-muted)";
                  }}
                >
                  <Icon size={24} />
                </button>
              );
            })()}
          </div>
        </nav>

        {/* Side Bar — 250px, hidden on narrow viewports */}
        <aside
          className="hidden sm:flex flex-col shrink-0 overflow-y-auto"
          style={{ width: 250, background: "var(--bg-sidebar)" }}
        >
          {/* Sidebar header */}
          <div
            className="px-[20px] py-[10px]"
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              color: "var(--fg-muted)",
              letterSpacing: "0.04em",
            }}
          >
            {sideBarTitle}
          </div>

          {/* Sidebar content */}
          <div className="flex-1 px-[10px]">
            {activeId === "wizard" && (
              <SideBarSection title="FoamPilot Wizard">
                <SideBarItem label="New Simulation" active />
              </SideBarSection>
            )}
            {activeId === "simulations" && (
              <SideBarSection title="Cases">
                <SideBarItem label="All Simulations" active />
              </SideBarSection>
            )}
            {activeId === "dashboard" && (
              <SideBarSection title="Dashboard">
                <SideBarItem label="Overview" active />
              </SideBarSection>
            )}
            {activeId === "logs" && (
              <SideBarSection title="Output">
                <SideBarItem label="Solver Logs" active />
              </SideBarSection>
            )}
            {activeId === "editor" && (
              <SideBarSection title="Files">
                <SideBarItem label="Dictionary Editor" active />
              </SideBarSection>
            )}
            {activeId === "settings" && (
              <SideBarSection title="Configuration">
                <SideBarItem label="General" active />
              </SideBarSection>
            )}
          </div>
        </aside>

        {/* Editor Area */}
        <main
          className="flex-1 overflow-auto min-w-0"
          style={{ background: "var(--bg-editor)" }}
        >
          <Routes>
            <Route path="/wizard" element={<WizardPage />} />
            <Route path="/simulations" element={<MySimulationsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
            <Route path="/logs" element={<PlaceholderPage title="Logs" />} />
            <Route path="/editor" element={<PlaceholderPage title="Dict Editor" />} />
            <Route path="*" element={<Navigate to="/wizard" replace />} />
          </Routes>
        </main>
      </div>

      {/* Status Bar — 22px, dark zinc with amber indicators */}
      <footer
        className="flex items-center px-[10px] shrink-0"
        style={{
          height: 22,
          background: "var(--bg-statusbar)",
          borderTop: "1px solid var(--border)",
          color: "var(--fg-muted)",
          fontSize: 12,
          fontFamily: "var(--font-ui)",
        }}
      >
        <span style={{ color: "var(--accent)" }} className={status.working ? "animate-pulse" : ""}>●</span>
        <span className="ml-[6px]">FoamPilot — {status.working ? "Working" : "Ready"}</span>
        {status.working && status.elapsed > 0 && (
          <span className="ml-[6px]">
            — {formatElapsed(status.elapsed)}
          </span>
        )}
      </footer>
    </div>
  );
}

function SideBarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-[4px]">
      <div
        className="px-[10px] py-[4px]"
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          color: "var(--fg-muted)",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function SideBarItem({ label, active }: { label: string; active?: boolean }) {
  return (
    <div
      className="px-[10px] cursor-default transition-colors duration-100"
      style={{
        height: 22,
        display: "flex",
        alignItems: "center",
        fontSize: 13,
        color: active ? "var(--fg)" : "var(--fg)",
        background: active ? "var(--bg-selection)" : "transparent",
        borderRadius: 0,
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      {label}
    </div>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div
      className="flex items-center justify-center h-full"
      style={{ color: "var(--fg-muted)" }}
    >
      <div className="text-center">
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, fontFamily: "var(--font-display)" }}>{title}</h2>
        <p style={{ fontSize: 13 }}>Coming soon — use the Wizard for now.</p>
      </div>
    </div>
  );
}

export default function App() {
  const [config, setAppConfig] = useState<AppConfig | null>(null);
  const [dockerReady, setDockerReady] = useState(false);
  const [updateToast, setUpdateToast] = useState<string | null>(null);

  useEffect(() => {
    if (window.foamPilot?.getConfig) {
      window.foamPilot.getConfig().then((c) => {
        setConfig(c);
        setAppConfig(c);
      });
    } else {
      const defaults: AppConfig = {
        backendUrl: "http://localhost:8000",
        localCasesPath: "C:\\Dev\\FoamPilot\\cases",
        paraViewPath: "C:\\Program Files\\ParaView 6.0.1\\bin\\paraview.exe",
        cores: 10,
      };
      // Load saved settings from localStorage
      try {
        const saved = localStorage.getItem("foampilot-config");
        if (saved) {
          const parsed = JSON.parse(saved);
          Object.assign(defaults, parsed);
        }
      } catch { /* ignore parse errors */ }
      setConfig(defaults);
      setAppConfig(defaults);
    }

    // Check Docker status on mount — if backend is already healthy, skip setup
    if (window.foamPilot?.docker) {
      window.foamPilot.docker.healthCheck().then((healthy) => {
        if (healthy) setDockerReady(true);
      }).catch(() => {});

      // Listen for update notifications
      const unsub = window.foamPilot.updates?.onAvailable?.((info) => {
        if (info.type === "container") {
          setUpdateToast(`Container update available: v${info.latest}`);
          setTimeout(() => setUpdateToast(null), 8000);
        } else if (info.type === "electron") {
          setUpdateToast("App update downloading...");
          setTimeout(() => setUpdateToast(null), 8000);
        }
      });
      return () => { unsub?.(); };
    }
  }, []);

  if (!config)
    return (
      <div
        className="flex items-center justify-center h-screen"
        style={{ color: "var(--fg-muted)" }}
      >
        Loading...
      </div>
    );

  // Show setup page if Docker/backend not ready (only in Electron context)
  if (!dockerReady && window.foamPilot?.docker) {
    return <SetupPage onReady={() => setDockerReady(true)} />;
  }

  return (
    <HashRouter>
      <StatusProvider>
        <AppShell />
        {/* Update toast notification */}
        {updateToast && (
          <div
            className="fixed bottom-8 right-8 px-4 py-2 text-[13px] font-medium z-50"
            style={{
              backgroundColor: "var(--accent)",
              color: "#09090B",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            {updateToast}
          </div>
        )}
      </StatusProvider>
    </HashRouter>
  );
}
