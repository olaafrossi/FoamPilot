import { useState, useEffect, useCallback } from "react";
import { Loader2, CheckCircle2, XCircle, Download, ExternalLink, RefreshCw } from "lucide-react";
import type { DockerFullStatus } from "../types";

type SetupStep = "docker-check" | "pulling" | "starting" | "ready";

interface SetupPageProps {
  onReady: () => void;
}

/** Platform-specific Docker install URL. */
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
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const checkDocker = useCallback(async () => {
    if (!window.foamPilot?.docker) return;
    setChecking(true);
    setError(null);
    try {
      const status = await window.foamPilot.docker.getStatus();
      setDockerStatus(status);

      if (status.installed && status.running && status.composeAvailable) {
        // Docker is ready — check if container is already running
        if (status.container === "running") {
          const healthy = await window.foamPilot.docker.healthCheck();
          if (healthy) {
            setStep("ready");
            setTimeout(onReady, 800);
            return;
          }
        }
        // Need to set up and pull
        setStep("pulling");
        await runSetup();
      }
    } catch (e: any) {
      setError(e.message || "Failed to check Docker status");
    } finally {
      setChecking(false);
    }
  }, [onReady]);

  const runSetup = async () => {
    try {
      // Ensure data directory + .env
      await window.foamPilot.docker.ensureSetup();

      // Pull the image
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

      // Start the container
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
          {/* Step 1: Docker Check */}
          <StepRow
            label="Docker Desktop"
            description={
              dockerMissing
                ? "Docker is not installed"
                : dockerNotRunning
                  ? "Docker is installed but not running"
                  : composeMissing
                    ? "Docker Compose is not available"
                    : dockerStatus?.version
                      ? `Version ${dockerStatus.version}`
                      : "Checking..."
            }
            status={
              step === "docker-check" && checking
                ? "loading"
                : dockerStatus?.installed && dockerStatus?.running && dockerStatus?.composeAvailable
                  ? "done"
                  : dockerMissing || dockerNotRunning || composeMissing
                    ? "error"
                    : "loading"
            }
          />

          {/* Step 2: Image Pull */}
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

          {/* Step 3: Backend Start */}
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

        {/* Pull progress log */}
        {step === "pulling" && progressLines.length > 0 && (
          <div
            className="mt-6 p-3 overflow-auto font-mono text-[11px]"
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

        {/* Action buttons */}
        <div className="mt-6 flex justify-center gap-3">
          {dockerMissing && (
            <ActionButton
              icon={<ExternalLink size={14} />}
              label="Install Docker"
              onClick={() => window.open(getDockerInstallUrl(), "_blank")}
            />
          )}

          {dockerNotRunning && (
            <ActionButton
              icon={<ExternalLink size={14} />}
              label="Start Docker Desktop"
              onClick={() => {
                // Can't auto-start, just inform user
                setError("Please start Docker Desktop manually, then click Check Again.");
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

          {(dockerMissing || dockerNotRunning || composeMissing || error) && (
            <ActionButton
              icon={<RefreshCw size={14} />}
              label="Check Again"
              onClick={checkDocker}
              disabled={checking}
            />
          )}
        </div>

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
