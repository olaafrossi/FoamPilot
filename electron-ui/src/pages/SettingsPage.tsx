import { useState, useEffect } from "react";
import { getConfig, setConfig } from "../api";
import type { AppConfig, ContainerUpdateInfo } from "../types";

export default function SettingsPage() {
  const [form, setForm] = useState<AppConfig>(() => ({ ...getConfig() }));
  const [saved, setSaved] = useState(false);
  const [containerStatus, setContainerStatus] = useState<string>("unknown");
  const [imageVersion, setImageVersion] = useState<string>("--");
  const [dockerActionInProgress, setDockerActionInProgress] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<ContainerUpdateInfo | null>(null);
  const [updateCheckMsg, setUpdateCheckMsg] = useState("");

  const hasDocker = !!window.foamPilot?.docker;

  useEffect(() => {
    if (!hasDocker) return;
    window.foamPilot.docker.getContainerStatus().then(setContainerStatus).catch(() => {});
    window.foamPilot.docker.getImageVersion().then(setImageVersion).catch(() => {});
  }, [hasDocker]);

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
    if (!hasDocker) return;
    setDockerActionInProgress(true);
    try {
      await window.foamPilot.docker.stop();
      await window.foamPilot.docker.start();
      setContainerStatus("running");
    } catch {
      setContainerStatus("error");
    } finally {
      setDockerActionInProgress(false);
    }
  };

  const handlePullLatest = async () => {
    if (!hasDocker) return;
    setDockerActionInProgress(true);
    try {
      await window.foamPilot.docker.pull();
      await handleRestartBackend();
      const ver = await window.foamPilot.docker.getImageVersion();
      setImageVersion(ver);
    } catch {
      // Pull failed
    } finally {
      setDockerActionInProgress(false);
    }
  };

  const handleCheckUpdates = async () => {
    if (!hasDocker) return;
    setUpdateCheckMsg("Checking...");
    try {
      const info = await window.foamPilot.updates.checkContainer();
      setUpdateInfo(info);
      if (info?.available) {
        setUpdateCheckMsg(`Update available: v${info.latest}`);
      } else {
        setUpdateCheckMsg("You're up to date.");
      }
    } catch {
      setUpdateCheckMsg("Failed to check for updates.");
    }
    setTimeout(() => setUpdateCheckMsg(""), 5000);
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--fg)", marginBottom: 24, fontFamily: "var(--font-display)" }}>Settings</h1>

      {/* General settings */}
      <div className="space-y-4">
        <SettingInput label="Backend URL" value={form.backendUrl} onChange={(v) => update("backendUrl", v)} />
        <SettingInput label="Local Cases Path" value={form.localCasesPath} onChange={(v) => update("localCasesPath", v)} />
        <SettingInput label="ParaView Path" value={form.paraViewPath} onChange={(v) => update("paraViewPath", v)} />
        <SettingInput
          label="CPU Cores (for parallel meshing & solving)"
          value={String(form.cores)}
          type="number"
          onChange={(v) => update("cores", Math.max(1, parseInt(v) || 1))}
        />
      </div>
      <div className="mt-6 flex items-center gap-4">
        <SettingButton label="Save Settings" onClick={handleSave} primary />
        {saved && <span className="text-[13px]" style={{ color: "var(--success)" }}>Settings saved</span>}
      </div>

      {/* Docker section */}
      {hasDocker && (
        <>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--fg)", marginTop: 40, marginBottom: 16, fontFamily: "var(--font-display)" }}>
            Docker
          </h2>
          <div style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)", padding: 16 }}>
            <div className="flex items-center gap-4 mb-3">
              <span className="text-[13px]" style={{ color: "var(--fg-muted)" }}>Container:</span>
              <StatusBadge status={containerStatus} />
              <span className="text-[13px] ml-auto" style={{ color: "var(--fg-muted)" }}>
                Image: {imageVersion}
              </span>
            </div>
            <div className="flex gap-3">
              <SettingButton
                label="Restart Backend"
                onClick={handleRestartBackend}
                disabled={dockerActionInProgress}
              />
              <SettingButton
                label="Pull Latest"
                onClick={handlePullLatest}
                disabled={dockerActionInProgress}
              />
            </div>
          </div>

          {/* Updates section */}
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--fg)", marginTop: 32, marginBottom: 16, fontFamily: "var(--font-display)" }}>
            Updates
          </h2>
          <div style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)", padding: 16 }}>
            <div className="flex items-center gap-4">
              <SettingButton label="Check for Updates" onClick={handleCheckUpdates} />
              {updateCheckMsg && (
                <span className="text-[13px]" style={{ color: updateInfo?.available ? "var(--accent)" : "var(--fg-muted)" }}>
                  {updateCheckMsg}
                </span>
              )}
            </div>
          </div>
        </>
      )}

      <p className="text-[13px] mt-6" style={{ color: "var(--fg-muted)" }}>
        Settings are stored in your browser. CPU cores controls how many parallel
        processes OpenFOAM uses for meshing and solving.
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "var(--success, #22c55e)",
    stopped: "var(--fg-muted)",
    not_found: "var(--fg-muted)",
    error: "var(--error, #ef4444)",
    unknown: "var(--fg-muted)",
  };
  return (
    <span className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: colors[status] ?? colors.unknown }}>
      <span style={{ fontSize: 10 }}>{status === "running" ? "\u25CF" : "\u25CB"}</span>
      {status}
    </span>
  );
}

function SettingButton({ label, onClick, primary, disabled }: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
      style={{
        backgroundColor: primary ? "var(--accent)" : "var(--bg-input)",
        color: primary ? "#09090B" : "var(--fg)",
        border: primary ? "none" : "1px solid var(--border)",
      }}
    >
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
