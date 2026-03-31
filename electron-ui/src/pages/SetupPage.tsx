import { useState, useEffect, useCallback } from "react";
import { Loader2, CheckCircle2, XCircle, Download, ExternalLink, RefreshCw } from "lucide-react";
import type { DockerFullStatus, InstallProgress } from "../types";

type SetupStep =
  | "docker-check"
  | "wsl-install"
  | "need-reboot"
  | "installing-docker"
  | "docker-starting"
  | "pulling"
  | "starting"
  | "ready";

interface SetupPageProps {
  onReady: () => void;
}

const isWindows = navigator.userAgent.toLowerCase().includes("win");

/** Platform-specific Docker install URL (fallback for non-Windows). */
function getDockerInstallUrl(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "https://docs.docker.com/desktop/install/windows-install/";
  if (ua.includes("mac")) return "https://docs.docker.com/desktop/install/mac-install/";
  return "https://docs.docker.com/desktop/install/linux/";
}

export default function SetupPage({ onReady }: SetupPageProps) {
  const [step, setStep] = useState<SetupStep>("docker-check");
  const [dockerStatus, setDockerStatus] = useState<DockerFullStatus | null>(null);
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [wslOk, setWslOk] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);

  // Subscribe to install progress events
  useEffect(() => {
    if (!window.foamPilot?.docker?.onInstallProgress) return;
    const unsub = window.foamPilot.docker.onInstallProgress((data: InstallProgress) => {
      if (data.type === "download" && data.percent !== undefined) {
        setDownloadPercent(data.percent);
        setProgressLines((prev) => {
          const line = `Downloading... ${data.percent}% (${data.mb} MB)`;
          // Replace last download line instead of appending
          const filtered = prev.filter((l) => !l.startsWith("Downloading..."));
          return [...filtered.slice(-50), line];
        });
      } else if (data.line) {
        setProgressLines((prev) => [...prev.slice(-50), data.line!]);
      }
    });
    return unsub;
  }, []);

  const checkDocker = useCallback(async () => {
    if (!window.foamPilot?.docker) return;
    setChecking(true);
    setError(null);
    try {
      const status = await window.foamPilot.docker.getStatus();
      setDockerStatus(status);

      // Check WSL status on Windows
      if (isWindows) {
        const wsl = await window.foamPilot.docker.checkWsl();
        setWslOk(wsl.installed);

        // Check if resuming after reboot
        const installState = await window.foamPilot.docker.getInstallState();
        if (installState?.stage === "wsl-installed" && !status.installed) {
          // WSL was installed last session, now install Docker
          setStep("installing-docker");
          await installDockerFlow();
          return;
        }
      }

      if (status.installed && status.running && status.composeAvailable) {
        if (status.container === "running") {
          const healthy = await window.foamPilot.docker.healthCheck();
          if (healthy) {
            setStep("ready");
            setTimeout(onReady, 800);
            return;
          }
        }
        setStep("pulling");
        await runSetup();
      }
    } catch (e: any) {
      setError(e.message || "Failed to check Docker status");
    } finally {
      setChecking(false);
    }
  }, [onReady]);

  /** Install Docker via winget (or fallback), then start Docker Desktop. */
  const installDockerFlow = async () => {
    setInstalling(true);
    setError(null);
    setProgressLines([]);
    setDownloadPercent(0);
    try {
      setStep("installing-docker");
      const result = await window.foamPilot.docker.installDocker();
      if (!result.ok) {
        setError(result.error || "Docker installation failed.");
        setInstalling(false);
        return;
      }

      // Start Docker Desktop
      setStep("docker-starting");
      setProgressLines((prev) => [...prev, "Starting Docker Desktop..."]);
      const startResult = await window.foamPilot.docker.startDesktop();
      if (!startResult.ok) {
        setError(startResult.error || "Docker Desktop failed to start.");
        setInstalling(false);
        return;
      }

      // Docker is running, proceed to pull + start
      setStep("pulling");
      setInstalling(false);
      await runSetup();
    } catch (e: any) {
      setError(e.message || "Installation failed.");
      setInstalling(false);
    }
  };

  /** Install WSL, then prompt for reboot or continue. */
  const handleInstallWsl = async () => {
    setInstalling(true);
    setError(null);
    setStep("wsl-install");
    try {
      const result = await window.foamPilot.docker.installWsl();
      if (!result.ok) {
        setError(result.error || "WSL installation failed.");
        setStep("docker-check");
        setInstalling(false);
        return;
      }
      if (result.needsReboot) {
        setWslOk(true);
        setStep("need-reboot");
        setInstalling(false);
      } else {
        // No reboot needed (WSL was already partially installed)
        setWslOk(true);
        await installDockerFlow();
      }
    } catch (e: any) {
      setError(e.message || "WSL installation failed.");
      setStep("docker-check");
      setInstalling(false);
    }
  };

  /** Full install: start with WSL if needed, then Docker. */
  const handleInstallDocker = async () => {
    if (isWindows && wslOk === false) {
      await handleInstallWsl();
    } else {
      await installDockerFlow();
    }
  };

  const runSetup = async () => {
    try {
      await window.foamPilot.docker.ensureSetup();

      setStep("pulling");
      setProgressLines([]);
      const unsub = window.foamPilot.docker.onProgress((line) => {
        setProgressLines((prev) => [...prev.slice(-50), line]);
      });

      const pullResult = await window.foamPilot.docker.pull();
      unsub();

      if (!pullResult.ok) {
        setError(pullResult.error || "Failed to pull container image");
        return;
      }

      setStep("starting");
      const startResult = await window.foamPilot.docker.start();

      if (!startResult.ok) {
        setError(startResult.error || "Failed to start backend");
        return;
      }

      if (!startResult.healthy) {
        setError("Backend started but health check failed. Check Docker logs.");
        return;
      }

      setStep("ready");
      setTimeout(onReady, 800);
    } catch (e: any) {
      setError(e.message || "Setup failed");
    }
  };

  useEffect(() => {
    checkDocker();
  }, [checkDocker]);

  const dockerMissing = dockerStatus && !dockerStatus.installed;
  const dockerNotRunning = dockerStatus && dockerStatus.installed && !dockerStatus.running;
  const composeMissing = dockerStatus && dockerStatus.installed && dockerStatus.running && !dockerStatus.composeAvailable;

  // Determine which steps to show based on platform and state
  const showWslStep = isWindows;
  const showDockerInstallStep = dockerMissing || step === "installing-docker" || step === "docker-starting";

  return (
    <div
      className="flex items-center justify-center h-screen"
      style={{ background: "var(--bg-editor)", fontFamily: "var(--font-ui)" }}
    >
      <div className="w-full max-w-lg p-8">
        <h1
          className="text-center mb-2"
          style={{ fontSize: 28, fontWeight: 800, color: "var(--fg)", fontFamily: "var(--font-display)" }}
        >
          FoamPilot Setup
        </h1>
        <p className="text-center mb-8" style={{ fontSize: 13, color: "var(--fg-muted)" }}>
          Setting up your simulation environment
        </p>

        {/* Step indicators */}
        <div className="space-y-4">
          {/* WSL step (Windows only) */}
          {showWslStep && (
            <StepRow
              label="WSL2"
              description={
                step === "wsl-install"
                  ? "Installing WSL2..."
                  : step === "need-reboot"
                    ? "Installed — reboot required"
                    : wslOk === true
                      ? "Enabled"
                      : wslOk === false
                        ? "Not installed"
                        : "Checking..."
              }
              status={
                step === "wsl-install"
                  ? "loading"
                  : wslOk === true || step === "need-reboot"
                    ? "done"
                    : wslOk === false
                      ? "error"
                      : "loading"
              }
            />
          )}

          {/* Docker Desktop step */}
          <StepRow
            label="Docker Desktop"
            description={
              step === "installing-docker"
                ? progressLines[progressLines.length - 1] || "Installing..."
                : step === "docker-starting"
                  ? "Starting Docker Desktop..."
                  : dockerMissing
                    ? "Not installed"
                    : dockerNotRunning
                      ? "Installed but not running"
                      : composeMissing
                        ? "Docker Compose not available"
                        : dockerStatus?.version
                          ? `Version ${dockerStatus.version}`
                          : "Checking..."
            }
            status={
              step === "installing-docker" || step === "docker-starting"
                ? "loading"
                : dockerStatus?.installed && dockerStatus?.running && dockerStatus?.composeAvailable
                  ? "done"
                  : dockerMissing || dockerNotRunning || composeMissing
                    ? "error"
                    : step === "docker-check" && checking
                      ? "loading"
                      : "loading"
            }
          />

          {/* Container Image step */}
          <StepRow
            label="Container Image"
            description={
              step === "pulling"
                ? progressLines[progressLines.length - 1] || "Pulling image..."
                : step === "starting" || step === "ready"
                  ? "Image ready"
                  : "Waiting..."
            }
            status={
              step === "pulling"
                ? "loading"
                : step === "starting" || step === "ready"
                  ? "done"
                  : "pending"
            }
          />

          {/* Backend Server step */}
          <StepRow
            label="Backend Server"
            description={
              step === "starting"
                ? "Starting and checking health..."
                : step === "ready"
                  ? "Running on localhost:8000"
                  : "Waiting..."
            }
            status={
              step === "starting"
                ? "loading"
                : step === "ready"
                  ? "done"
                  : "pending"
            }
          />
        </div>

        {/* Download progress bar */}
        {step === "installing-docker" && downloadPercent > 0 && (
          <div className="mt-6">
            <div
              style={{
                height: 6,
                backgroundColor: "var(--bg-surface)",
                border: "1px solid var(--border)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${downloadPercent}%`,
                  backgroundColor: "var(--accent)",
                  transition: "width 200ms ease",
                }}
              />
            </div>
          </div>
        )}

        {/* Progress log */}
        {(step === "pulling" || step === "installing-docker") && progressLines.length > 0 && (
          <div
            className="mt-4 p-3 overflow-auto font-mono text-[11px]"
            style={{
              maxHeight: 160,
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border)",
              color: "var(--fg-muted)",
            }}
          >
            {progressLines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div
            className="mt-6 p-4"
            style={{
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#EF4444",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {/* Reboot screen */}
        {step === "need-reboot" && (
          <div className="mt-6 text-center" style={{ fontSize: 13, color: "var(--fg-muted)" }}>
            <p>Windows needs to restart to finish setting up WSL2.</p>
            <p className="mt-1">FoamPilot will continue the Docker installation after reboot.</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-6 flex justify-center gap-3">
          {/* Windows: auto-install Docker (when Docker missing and not already installing) */}
          {isWindows && dockerMissing && !installing && step !== "need-reboot" && (
            <ActionButton
              icon={<Download size={14} />}
              label="Install Docker"
              onClick={handleInstallDocker}
            />
          )}

          {/* Non-Windows: browser link */}
          {!isWindows && dockerMissing && (
            <ActionButton
              icon={<ExternalLink size={14} />}
              label="Install Docker"
              onClick={() => window.open(getDockerInstallUrl(), "_blank")}
            />
          )}

          {/* Reboot buttons */}
          {step === "need-reboot" && (
            <>
              <ActionButton
                icon={<RefreshCw size={14} />}
                label="Restart Now"
                onClick={() => {
                  // Windows shutdown with 5s countdown
                  window.foamPilot?.docker?.installWsl(); // no-op, just for type
                  // Use a simple approach: tell user to restart
                  setError("Please restart your computer, then reopen FoamPilot.");
                }}
              />
              <ActionButton
                icon={<ExternalLink size={14} />}
                label="I'll restart later"
                onClick={() => {
                  setError("FoamPilot will continue Docker setup after you restart your computer.");
                }}
              />
            </>
          )}

          {dockerNotRunning && !installing && (
            <ActionButton
              icon={<ExternalLink size={14} />}
              label="Start Docker Desktop"
              onClick={async () => {
                setError(null);
                setStep("docker-starting");
                const result = await window.foamPilot.docker.startDesktop();
                if (result.ok) {
                  setStep("pulling");
                  await runSetup();
                } else {
                  setError(result.error || "Failed to start Docker Desktop.");
                  setStep("docker-check");
                }
              }}
            />
          )}

          {composeMissing && (
            <ActionButton
              icon={<ExternalLink size={14} />}
              label="Install Docker Desktop"
              onClick={() => window.open(getDockerInstallUrl(), "_blank")}
              subtitle="Includes Compose"
            />
          )}

          {(dockerMissing || dockerNotRunning || composeMissing || error) && !installing && step !== "need-reboot" && (
            <ActionButton
              icon={<RefreshCw size={14} />}
              label="Check Again"
              onClick={checkDocker}
              disabled={checking}
            />
          )}
        </div>

        {/* Docker license note during install */}
        {(step === "installing-docker" || (dockerMissing && isWindows)) && (
          <p className="text-center mt-4" style={{ fontSize: 11, color: "var(--fg-muted)", opacity: 0.7 }}>
            Docker Desktop is free for individuals, education, and small businesses.{" "}
            <a
              href="https://www.docker.com/pricing/"
              style={{ color: "var(--fg-muted)", textDecoration: "underline" }}
              onClick={(e) => { e.preventDefault(); window.open("https://www.docker.com/pricing/", "_blank"); }}
            >
              License terms
            </a>
          </p>
        )}

        {step === "ready" && (
          <p className="text-center mt-6" style={{ fontSize: 13, color: "var(--success)" }}>
            Ready — launching FoamPilot...
          </p>
        )}

        {/* Always allow skipping setup */}
        {step !== "ready" && (
          <button
            onClick={onReady}
            className="block mx-auto mt-6 text-[12px] transition-colors"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--fg-muted)",
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: 2,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--fg)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--fg-muted)"; }}
          >
            Skip — continue without Docker
          </button>
        )}
      </div>
    </div>
  );
}

function StepRow({
  label,
  description,
  status,
}: {
  label: string;
  description: string;
  status: "pending" | "loading" | "done" | "error";
}) {
  return (
    <div
      className="flex items-center gap-4 p-4"
      style={{
        backgroundColor: "var(--bg-surface)",
        border: "1px solid var(--border)",
        opacity: status === "pending" ? 0.5 : 1,
      }}
    >
      <div className="shrink-0">
        {status === "loading" && <Loader2 size={20} className="animate-spin" style={{ color: "var(--accent)" }} />}
        {status === "done" && <CheckCircle2 size={20} style={{ color: "var(--success)" }} />}
        {status === "error" && <XCircle size={20} style={{ color: "#EF4444" }} />}
        {status === "pending" && (
          <div style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid var(--border)" }} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold" style={{ color: "var(--fg)" }}>{label}</div>
        <div className="text-[12px] truncate" style={{ color: "var(--fg-muted)" }}>{description}</div>
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  subtitle,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  subtitle?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 px-5 py-2 text-[13px] font-semibold transition-colors"
      style={{
        backgroundColor: "var(--accent)",
        color: "#09090B",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        border: "none",
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.backgroundColor = "var(--accent-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--accent)"; }}
    >
      {icon}
      <span>
        {label}
        {subtitle && <span className="ml-1 font-normal" style={{ opacity: 0.7 }}>({subtitle})</span>}
      </span>
    </button>
  );
}
