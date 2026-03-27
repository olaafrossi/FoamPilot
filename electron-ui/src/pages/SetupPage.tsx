import { useState, useEffect, useCallback } from "react";

interface SetupPageProps {
  onReady: () => void;
}

type SetupStep = "checking" | "no-docker" | "pulling" | "starting" | "ready" | "error";

const DOCKER_URLS: Record<string, string> = {
  Win32: "https://docs.docker.com/desktop/setup/install/windows-install/",
  Darwin: "https://docs.docker.com/desktop/setup/install/mac-install/",
  Linux: "https://docs.docker.com/desktop/setup/install/linux/",
};

function getPlatform(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Win")) return "Win32";
  if (ua.includes("Mac")) return "Darwin";
  return "Linux";
}

export default function SetupPage({ onReady }: SetupPageProps) {
  const [step, setStep] = useState<SetupStep>("checking");
  const [progress, setProgress] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  const addProgress = useCallback((msg: string) => {
    setProgress((prev) => [...prev.slice(-50), msg]);
  }, []);

  const runSetup = useCallback(async () => {
    setStep("checking");
    setErrorMsg("");
    setProgress([]);

    try {
      addProgress("Checking Docker installation...");
      const status = await window.foamPilot.docker.getStatus();

      if (!status.installed) {
        setStep("no-docker");
        return;
      }

      if (!status.running) {
        setErrorMsg("Docker is installed but not running. Please start Docker Desktop and try again.");
        setStep("error");
        return;
      }

      addProgress(`Docker ${status.version ?? ""} detected.`);

      // Pull image
      setStep("pulling");
      addProgress("Pulling container image (this may take a few minutes on first run)...");
      await window.foamPilot.docker.pull();

      // Start container
      setStep("starting");
      addProgress("Starting FoamPilot backend...");
      await window.foamPilot.docker.start();

      addProgress("Backend is ready.");
      setStep("ready");

      // Brief pause so user sees "ready" state
      setTimeout(onReady, 800);
    } catch (err: any) {
      setErrorMsg(err?.message ?? "An unexpected error occurred.");
      setStep("error");
    }
  }, [addProgress, onReady]);

  useEffect(() => {
    // Listen for progress messages from main process
    const cleanup = window.foamPilot.docker.onProgress((msg: string) => {
      addProgress(msg);
    });
    runSetup();
    return cleanup;
  }, [runSetup, addProgress]);

  return (
    <div
      className="flex items-center justify-center h-screen"
      style={{ background: "var(--bg-editor)" }}
    >
      <div
        className="w-full max-w-lg p-8"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
        }}
      >
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: "var(--fg)",
            marginBottom: 4,
            fontFamily: "var(--font-display)",
          }}
        >
          FoamPilot Setup
        </h1>
        <p
          className="mb-6"
          style={{ fontSize: 13, color: "var(--fg-muted)" }}
        >
          Preparing your simulation environment...
        </p>

        {/* Step indicators */}
        <div className="space-y-3 mb-6">
          <StepIndicator
            label="Docker"
            status={
              step === "checking"
                ? "active"
                : step === "no-docker"
                  ? "error"
                  : "done"
            }
          />
          <StepIndicator
            label="Container image"
            status={
              step === "pulling"
                ? "active"
                : step === "starting" || step === "ready"
                  ? "done"
                  : "pending"
            }
          />
          <StepIndicator
            label="Backend startup"
            status={
              step === "starting"
                ? "active"
                : step === "ready"
                  ? "done"
                  : "pending"
            }
          />
        </div>

        {/* Progress log */}
        {progress.length > 0 && (
          <div
            className="mb-4 p-3 overflow-y-auto font-mono text-[12px]"
            style={{
              maxHeight: 160,
              background: "var(--bg-input)",
              border: "1px solid var(--border)",
              color: "var(--fg-muted)",
            }}
          >
            {progress.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}

        {/* No Docker state */}
        {step === "no-docker" && (
          <div className="space-y-3">
            <p style={{ fontSize: 13, color: "var(--fg)" }}>
              Docker Desktop is required to run FoamPilot simulations.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  const url = DOCKER_URLS[getPlatform()] ?? DOCKER_URLS.Linux;
                  window.open(url, "_blank");
                }}
                className="px-4 py-2 text-[13px] font-semibold"
                style={{
                  backgroundColor: "var(--accent)",
                  color: "#09090B",
                }}
              >
                Install Docker
              </button>
              <button
                onClick={runSetup}
                className="px-4 py-2 text-[13px] font-semibold"
                style={{
                  backgroundColor: "var(--bg-input)",
                  color: "var(--fg)",
                  border: "1px solid var(--border)",
                }}
              >
                Check Again
              </button>
            </div>
          </div>
        )}

        {/* Error state */}
        {step === "error" && (
          <div className="space-y-3">
            <p style={{ fontSize: 13, color: "var(--error, #ef4444)" }}>
              {errorMsg}
            </p>
            <button
              onClick={runSetup}
              className="px-4 py-2 text-[13px] font-semibold"
              style={{
                backgroundColor: "var(--bg-input)",
                color: "var(--fg)",
                border: "1px solid var(--border)",
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Ready state */}
        {step === "ready" && (
          <p
            style={{
              fontSize: 13,
              color: "var(--success, #22c55e)",
              fontWeight: 600,
            }}
          >
            Ready — launching FoamPilot...
          </p>
        )}
      </div>
    </div>
  );
}

function StepIndicator({
  label,
  status,
}: {
  label: string;
  status: "pending" | "active" | "done" | "error";
}) {
  const colors: Record<string, string> = {
    pending: "var(--fg-muted)",
    active: "var(--accent)",
    done: "var(--success, #22c55e)",
    error: "var(--error, #ef4444)",
  };
  const icons: Record<string, string> = {
    pending: "\u25CB",
    active: "\u25CF",
    done: "\u2713",
    error: "\u2717",
  };

  return (
    <div className="flex items-center gap-2" style={{ fontSize: 13 }}>
      <span
        style={{ color: colors[status], fontWeight: 700, width: 16, textAlign: "center" }}
        className={status === "active" ? "animate-pulse" : ""}
      >
        {icons[status]}
      </span>
      <span style={{ color: status === "pending" ? "var(--fg-muted)" : "var(--fg)" }}>
        {label}
      </span>
    </div>
  );
}
