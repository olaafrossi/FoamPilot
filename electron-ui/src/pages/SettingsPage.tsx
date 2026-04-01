import { useState, useEffect } from "react";
import { getConfig, setConfig, syncCoresFromBackend } from "../api";
import type { AppConfig, DockerFullStatus, ContainerUpdateInfo, AppUpdateInfo, SystemResources } from "../types";
import { RefreshCw, Loader2, ChevronDown, ChevronRight } from "lucide-react";

export default function SettingsPage() {
  const [form, setForm] = useState<AppConfig>(() => ({ ...getConfig() }));
  const [saved, setSaved] = useState(false);
  const [pendingRestart, setPendingRestart] = useState(false);

  // System resources for validation bounds
  const [sysResources, setSysResources] = useState<SystemResources>({ cpus: 16, memoryGB: 32 });

  // Active (running) config from backend
  const [activeCores, setActiveCores] = useState<number | null>(null);

  // Docker state
  const [dockerStatus, setDockerStatus] = useState<DockerFullStatus | null>(null);
  const [containerAction, setContainerAction] = useState<string | null>(null);

  // Update state
  const [appVersion, setAppVersion] = useState<string>("—");
  const [containerUpdate, setContainerUpdate] = useState<ContainerUpdateInfo | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null);
  const [updateCheckDone, setUpdateCheckDone] = useState(false);
  const [updateCheckError, setUpdateCheckError] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  // Advanced section collapsed state
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    // Load config from Electron main process (settings.json) if available
    if (window.foamPilot?.getConfig) {
      window.foamPilot.getConfig().then((cfg) => {
        setForm((prev) => ({ ...prev, ...cfg }));
        setConfig({ ...getConfig(), ...cfg });
      }).catch(() => {});
    }

    // Sync active cores from backend (what's actually running)
    syncCoresFromBackend().then((cores) => {
      if (cores !== null) setActiveCores(cores);
    });

    // Get system resources for validation bounds
    if (window.foamPilot?.docker?.getSystemResources) {
      window.foamPilot.docker.getSystemResources().then(setSysResources).catch(() => {});
    }

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

  const updateNumber = (key: keyof AppConfig, raw: string, min: number, max: number) => {
    const n = Math.max(min, Math.min(max, Math.floor(Number(raw) || min)));
    update(key, n);
  };

  // Check if resource settings differ from what was last applied
  const resourcesChanged = (config: AppConfig): boolean => {
    // Compare against active backend cores if available
    if (activeCores !== null && config.cores !== activeCores) return true;
    // For dockerCpus and dockerMemory, we can't check active state easily,
    // so check against saved form on mount (any change triggers restart offer)
    return false;
  };

  const coresExceedCpus = form.cores > form.dockerCpus;

  const handleSave = async () => {
    const configToSave = {
      ...form,
      cores: Math.floor(form.cores),
      dockerCpus: Math.floor(form.dockerCpus),
      dockerMemory: Math.floor(form.dockerMemory),
    };

    // Update in-memory config
    setConfig(configToSave);

    // Persist to settings.json via Electron IPC (primary), localStorage (fallback)
    if (window.foamPilot?.saveConfig) {
      await window.foamPilot.saveConfig(configToSave);
    } else {
      localStorage.setItem("foampilot-config", JSON.stringify(configToSave));
    }

    // Check if resource settings changed and Docker is available
    const needsRestart = window.foamPilot?.docker &&
      (activeCores !== null && configToSave.cores !== activeCores);

    if (needsRestart) {
      const confirmed = window.confirm(
        "This will restart the container and stop any running simulation. Continue?"
      );
      if (confirmed) {
        setContainerAction("restarting");
        try {
          const result = await window.foamPilot.docker.updateResources(configToSave);
          if (result.ok) {
            setActiveCores(configToSave.cores);
            setPendingRestart(false);
            const status = await window.foamPilot.docker.getStatus();
            setDockerStatus(status);
          } else {
            alert(`Failed to restart container: ${result.error || "Unknown error"}`);
          }
        } catch (e: any) {
          alert(`Error restarting container: ${e.message}`);
        }
        setContainerAction(null);
      } else {
        setPendingRestart(true);
      }
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleRestartBackend = async () => {
    if (!window.foamPilot?.docker) return;
    setContainerAction("restarting");
    try {
      // Write latest config to .env before restart
      const result = await window.foamPilot.docker.updateResources(form);
      if (!result.ok) {
        alert(`Failed to restart backend: ${result.error || "Unknown error"}`);
        setContainerAction(null);
        return;
      }
      setActiveCores(form.cores);
      setPendingRestart(false);
      const status = await window.foamPilot.docker.getStatus();
      setDockerStatus(status);
    } catch (e: any) {
      alert(`Error restarting backend: ${e.message}`);
    }
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
    setUpdateCheckDone(false);
    setUpdateCheckError(false);
    try {
      const result = await window.foamPilot.updates.check();
      setContainerUpdate(result.container);
      setAppUpdate(result.app);
      setUpdateCheckDone(true);
      if (!result.app && !result.container) {
        setUpdateCheckError(true);
      }
    } catch {
      setUpdateCheckError(true);
      setUpdateCheckDone(true);
    }
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
      </div>

      {/* Resources Section */}
      <SectionHeader title="Resources" />
      <div className="space-y-4 mb-4">
        <NumberInput
          label="OpenFOAM Cores"
          hint="Parallel processes for meshing and solving (mpirun -np)"
          value={form.cores}
          min={1}
          max={form.dockerCpus}
          onChange={(v) => updateNumber("cores", v, 1, form.dockerCpus)}
        />
        {coresExceedCpus && (
          <div className="text-[12px] px-3 py-2" style={{ color: "#F59E0B", backgroundColor: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)" }}>
            OpenFOAM cores ({form.cores}) exceeds Docker CPU limit ({form.dockerCpus}). Performance will be degraded.
          </div>
        )}
        {activeCores !== null && activeCores !== form.cores && (
          <div className="text-[12px] px-3 py-2" style={{ color: "var(--fg-muted)", backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)" }}>
            Active: {activeCores} cores — Saved: {form.cores} cores
            {pendingRestart && " — pending restart"}
          </div>
        )}
      </div>

      {/* Advanced Docker Resources (collapsible) */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1.5 text-[12px] font-semibold mb-4"
        style={{ color: "var(--fg-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Docker Resource Limits
      </button>
      {showAdvanced && (
        <div className="space-y-4 mb-4 ml-4" style={{ borderLeft: "2px solid var(--border)", paddingLeft: 16 }}>
          <NumberInput
            label="Docker CPUs"
            hint={`Container CPU limit (host has ${sysResources.cpus} logical CPUs)`}
            value={form.dockerCpus}
            min={1}
            max={sysResources.cpus}
            onChange={(v) => updateNumber("dockerCpus", v, 1, sysResources.cpus)}
          />
          <NumberInput
            label="Docker Memory (GB)"
            hint={`Container memory limit (host has ${sysResources.memoryGB} GB)`}
            value={form.dockerMemory}
            min={2}
            max={sysResources.memoryGB}
            onChange={(v) => updateNumber("dockerMemory", v, 2, sysResources.memoryGB)}
          />
          <p className="text-[11px]" style={{ color: "var(--fg-muted)" }}>
            These are host limits. Docker Desktop may have its own lower limits configured in WSL2.
          </p>
        </div>
      )}

      <div className="mb-8 flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={!!containerAction}
          className="px-6 py-2 rounded-sm font-semibold text-[13px]"
          style={{
            backgroundColor: "var(--accent)",
            color: "#09090B",
            opacity: containerAction ? 0.5 : 1,
            cursor: containerAction ? "not-allowed" : "pointer",
          }}
          onMouseEnter={(e) => { if (!containerAction) e.currentTarget.style.backgroundColor = "var(--accent-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--accent)"; }}
        >
          {containerAction === "restarting" ? "Restarting..." : "Save Settings"}
        </button>
        {saved && (
          <span className="text-[13px]" style={{ color: "var(--success)" }}>Settings saved</span>
        )}
      </div>
      {pendingRestart && (
        <p className="text-[12px] mb-8 px-3 py-2" style={{ color: "#F59E0B", backgroundColor: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)" }}>
          Resource settings saved but not yet applied. Restart the container to apply changes.
        </p>
      )}
      <p className="text-[13px] mb-8" style={{ color: "var(--fg-muted)" }}>
        Settings are persisted{window.foamPilot ? " to settings.json" : " in your browser"}.
        Resource changes require a container restart to take effect.
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
            {/* App update status */}
            {appUpdate?.available && (
              <div
                className="p-3"
                style={{
                  backgroundColor: "rgba(245, 158, 11, 0.1)",
                  border: "1px solid rgba(245, 158, 11, 0.3)",
                  fontSize: 13,
                  color: "var(--accent)",
                }}
              >
                App update available: v{appUpdate.current} &rarr; v{appUpdate.latest}
                {appUpdate.downloadUrl ? (
                  <button
                    onClick={() => window.open(appUpdate.downloadUrl, "_blank")}
                    className="ml-3 underline font-semibold"
                    style={{ color: "var(--accent)" }}
                  >
                    View on GitHub
                  </button>
                ) : (
                  <span className="ml-3 text-[12px]" style={{ color: "var(--fg-muted)" }}>
                    Will install on next restart
                  </span>
                )}
              </div>
            )}
            {updateCheckDone && !updateCheckError && appUpdate && !appUpdate.available && (
              <div className="text-[13px]" style={{ color: "#22C55E" }}>
                App is up to date
              </div>
            )}
            {updateCheckDone && updateCheckError && (
              <div className="text-[13px]" style={{ color: "var(--fg-muted)" }}>
                Could not check for updates
              </div>
            )}
            {/* Container update status */}
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
                Container update available: v{containerUpdate.current} &rarr; v{containerUpdate.latest}
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

function NumberInput({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: string) => void;
}) {
  return (
    <div style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)", padding: 16, borderRadius: 0 }}>
      <label className="text-[13px] block mb-1" style={{ color: "var(--fg-muted)" }}>{label}</label>
      <p className="text-[11px] mb-2" style={{ color: "var(--fg-muted)", opacity: 0.7 }}>{hint}</p>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={1}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 font-mono text-[13px] px-3 py-1.5 focus:outline-none"
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
