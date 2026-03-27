import { useEffect, useState } from "react";
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { Rocket, FolderOpen, LayoutDashboard, Terminal, FileText, Settings } from "lucide-react";
import { setConfig } from "./api";
import type { AppConfig } from "./types";
import WizardPage from "./pages/WizardPage";
import MySimulationsPage from "./pages/MySimulationsPage";
import SettingsPage from "./pages/SettingsPage";

const NAV_ITEMS = [
  { id: "wizard", icon: Rocket, label: "Wizard", path: "/wizard" },
  { id: "simulations", icon: FolderOpen, label: "My Simulations", path: "/simulations" },
  { id: "dashboard", icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
  { id: "logs", icon: Terminal, label: "Logs", path: "/logs" },
  { id: "editor", icon: FileText, label: "Dict Editor", path: "/editor" },
] as const;

const SETTINGS_ITEM = { id: "settings", icon: Settings, label: "Settings", path: "/settings" } as const;

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();

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
    <div className="flex flex-col h-screen w-screen" style={{ fontFamily: "var(--font-ui)" }}>
      <div className="flex flex-1 min-h-0">
        {/* Activity Bar — 48px icon strip */}
        <nav
          className="flex flex-col shrink-0"
          style={{ width: 48, background: "var(--bg-activitybar)" }}
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeId === item.id;
            return (
              <button
                key={item.id}
                onClick={() => navigate(item.path)}
                title={item.label}
                className="relative flex items-center justify-center"
                style={{
                  width: 48,
                  height: 48,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  borderLeft: isActive ? "2px solid white" : "2px solid transparent",
                  color: isActive ? "#ffffff" : "#858585",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.color = "#ffffff";
                }}
                onMouseLeave={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.color = "#858585";
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
                  className="relative flex items-center justify-center"
                  style={{
                    width: 48,
                    height: 48,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    borderLeft: isActive ? "2px solid white" : "2px solid transparent",
                    color: isActive ? "#ffffff" : "#858585",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.color = "#858585";
                  }}
                >
                  <Icon size={24} />
                </button>
              );
            })()}
          </div>
        </nav>

        {/* Side Bar — 250px */}
        <aside
          className="flex flex-col shrink-0 overflow-y-auto"
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

      {/* Status Bar — 22px */}
      <footer
        className="flex items-center px-[10px] shrink-0"
        style={{
          height: 22,
          background: "var(--bg-statusbar)",
          color: "#ffffff",
          fontSize: 12,
          fontFamily: "var(--font-ui)",
        }}
      >
        <span>FoamPilot — Ready</span>
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
      className="px-[10px] cursor-default"
      style={{
        height: 22,
        display: "flex",
        alignItems: "center",
        fontSize: 13,
        color: active ? "#ffffff" : "var(--fg)",
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
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>{title}</h2>
        <p style={{ fontSize: 13 }}>Coming soon — use the Wizard for now.</p>
      </div>
    </div>
  );
}

export default function App() {
  const [config, setAppConfig] = useState<AppConfig | null>(null);

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

  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  );
}
