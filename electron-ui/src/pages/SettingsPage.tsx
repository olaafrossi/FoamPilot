import { useState, useEffect } from "react";
import { getConfig, setConfig, syncCoresFromBackend } from "../api";
import type { AppConfig, DockerFullStatus, ContainerUpdateInfo } from "../types";
import { RefreshCw, Loader2 } from "lucide-react";

export default function SettingsPage() {
  const [form, setForm] = useState<AppConfig>(() => ({ ...getConfig() }));
  const [saved, setSaved] = useState(false);

  // Docker state
  const [backendCores, setBackendCores] = useState<number | null>(null);

  // Docker state
  const [dockerStatus, setDockerStatus] = useState<DockerFullStatus | null>(null);
  const [containerAction, setContainerAction] = useState<string | null>(null);

  // Update state
  const [appVersion, setAppVersion] = useState<string>("—");
  const [containerUpdate, setContainerUpdate] = useState<ContainerUpdateInfo | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  useEffect(() => {
    syncCoresFromBackend().then((cores) => {
      if (cores !== null) {
        setBackendCores(cores);
        setForm((prev) => ({ ...prev, cores }));
      }
    });
    if (window.foamPilot?.docker) {
      window.foamPilot.docker.getStatus().then(setDockerStatus).catch(() => {});
    }
    if (window.foamPilot?.updates) {
      window.foamPilot.updates.getAppVersion().then(setAppVersion).catch(() => {});
    }
  }, []);

  const update = (key: keyof AppConfig, value: string | number) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    setConfig(form);
    localStorage.setItem("foampilot-config", JSON.stringify(form));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleRestartBackend = async () => {
    if (!window.foamPilot?.docker) return;
    setContainerAction("restarting");
    try {
      await window.foamPilot.docker.stop();
      await window.foamPilot.docker.start();
      const status = await window.foamPilot.docker.getStatus();
      setDockerStatus(status);
    } catch {}
    setContainerAction(null);
  };

  const handlePullLatest = async () => {
    if (!window.foamPilot?.docker) return;
    setContainerAction("pulling");
    try {
      await window.foamPilot.docker.pull();
      await window.foamPilot.docker.stop();
      await window.foamPilot.docker.start();
      const status = await window.foamPilot.docker.getStatus();
      setDockerStatus(status);
    } catch {}
    setContainerAction(null);
  };

  const handleCheckUpdates = async () => {
    if (!window.foamPilot?.updates) return;
    setCheckingUpdates(true);
    try {
      const result = await window.foamPilot.updates.check();
      setContainerUpdate(result.container);
    } catch {}
    setCheckingUpdates(false);
  };

  const handleApplyContainerUpdate = async () => {
    if (!containerUpdate?.latest || !window.foamPilot?.updates) return;
    setContainerAction("updating");
    try {
      await window.foamPilot.updates.applyContainer(containerUpdate.latest);
      setContainerUpdate(null);
      const status = await window.foamPilot.docker.getStatus();
      setDockerStatus(status);
    } catch {}
    setContainerAction(null);
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--fg)", marginBottom: 24, fontFamily: "var(--font-display)" }}>Settings</h1>

      {/* General Settings */}
      <SectionHeader title="General" />
      <div className="space-y-4 mb-8">
        <SettingInput
          label="Backend URL"
          value={form.backendUrl}
          onChange={(v) => update("backendUrl", v)}
        />
        <SettingInput
          label="Local Cases Path"
          value={form.localCasesPath}
          onChange={(v) => update("localCasesPath", v)}
        />
        <SettingInput
          label="ParaView Path"
          value={form.paraViewPath}
          onChange={(v) => update("paraViewPath", v)}
        />
        <div style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)", padding: 16, borderRadius: 0 }}>
          <label className="text-[13px] block mb-2" style={{ color: "var(--fg-muted)" }}>
            CPU Cores (for parallel meshing &amp; solving)
          </label>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[13px] px-3 py-1.5" style={{ backgroundColor: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--fg)" }}>
              {backendCores ?? form.cores}
            </span>
            <span className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
              Set by FOAM_CORES in docker/.env
            </span>
          </div>
        </div>
      </div>
      <div className="mb-8 flex items-center gap-4">
        <button
          onClick={handleSave}
          className="px-6 py-2 rounded-sm font-semibold text-[13px]"
          style={{ backgroundColor: "var(--accent)", color: "#09090B" }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--accent-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--accent)"; }}
        >
          Save Settings
        </button>
        {saved && (
          <span className="text-[13px]" style={{ color: "var(--success)" }}>Settings saved</span>
        )}
      </div>
      <p className="text-[13px] mb-8" style={{ color: "var(--fg-muted)" }}>
        Settings are stored in your browser. CPU cores is read from the Docker
        container&apos;s FOAM_CORES environment variable — edit <code style={{ color: "var(--fg)" }}>docker/.env</code> and
        restart the container to change it.
      </p>

      {/* Docker Section — only show in Electron context */}
      {window.foamPilot?.docker && (
        <>
          <SectionHeader title="Docker" />
          <div
            className="p-4 mb-4 space-y-3"
            style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px]" style={{ color: "var(--fg-muted)" }}>Container Status</span>
              <StatusBadge status={dockerStatus?.container || "not_found"} />
            </div>
            {dockerStatus?.version && (
              <div className="flex items-center justify-between">
                <span className="text-[13px]" style={{ color: "var(--fg-muted)" }}>Docker Version</span>
                <span className="text-[13px] font-mono" style={{ color: "var(--fg)" }}>{dockerStatus.version}</span>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <SmallButton
                label={containerAction === "restarting" ? "Restarting..." : "Restart Backend"}
                onClick={handleRestartBackend}
                disabled={!!containerAction}
                loading={containerAction === "restarting"}
              />
              <SmallButton
                label={containerAction === "pulling" ? "Pulling..." : "Pull Latest"}
                onClick={handlePullLatest}
                disabled={!!containerAction}
                loading={containerAction === "pulling"}
              />
            </div>
          </div>
        </>
      )}

      {/* Updates Section — only show in Electron context */}
      {window.foamPilot?.updates && (
        <>
          <SectionHeader title="Updates" />
          <div
            className="p-4 mb-4 space-y-3"
            style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px]" style={{ color: "var(--fg-muted)" }}>App Version</span>
              <span className="text-[13px] font-mono" style={{ color: "var(--fg)" }}>{appVersion}</span>
            </div>
            {containerUpdate?.available && (
              <div
                className="p-3"
                style={{
                  backgroundColor: "rgba(245, 158, 11, 0.1)",
                  border: "1px solid rgba(245, 158, 11, 0.3)",
                  fontSize: 13,
                  color: "var(--accent)",
                }}
              >
                Container update available: v{containerUpdate.current} → v{containerUpdate.latest}
                <button
                  onClick={handleApplyContainerUpdate}
                  disabled={containerAction === "updating"}
                  className="ml-3 underline font-semibold"
                  style={{ color: "var(--accent)" }}
                >
                  {containerAction === "updating" ? "Updating..." : "Update Now"}
                </button>
              </div>
            )}
            <div className="pt-2">
              <SmallButton
                label="Check for Updates"
                onClick={handleCheckUpdates}
                disabled={checkingUpdates}
                loading={checkingUpdates}
                icon={<RefreshCw size={12} />}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2
      className="mb-4"
      style={{
        fontSize: 14,
        fontWeight: 700,
        color: "var(--fg)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        borderBottom: "1px solid var(--border)",
        paddingBottom: 8,
      }}
    >
      {title}
    </h2>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    running: { bg: "rgba(34,197,94,0.15)", fg: "#22C55E" },
    stopped: { bg: "rgba(239,68,68,0.15)", fg: "#EF4444" },
    not_found: { bg: "rgba(161,161,170,0.15)", fg: "#A1A1AA" },
    unhealthy: { bg: "rgba(245,158,11,0.15)", fg: "#F59E0B" },
  };
  const c = colors[status] || colors.not_found;
  return (
    <span
      className="px-2 py-0.5 text-[11px] font-semibold uppercase"
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      {status}
    </span>
  );
}

function SmallButton({
  label,
  onClick,
  disabled,
  loading,
  icon,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold"
      style={{
        backgroundColor: "var(--bg-input)",
        border: "1px solid var(--border)",
        color: "var(--fg)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.borderColor = "var(--accent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

function SettingInput({
  label,
  value,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)", padding: 16, borderRadius: 0 }}>
      <label className="text-[13px] block mb-2" style={{ color: "var(--fg-muted)" }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full font-mono text-[13px] px-3 py-1.5 focus:outline-none"
        style={{
          backgroundColor: "var(--bg-input)",
          border: "1px solid var(--border)",
          color: "var(--fg)",
          borderRadius: 0,
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
      />
    </div>
  );
}
