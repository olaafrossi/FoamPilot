/**
 * Screenshot button for the 3D visualization canvas.
 *
 * Captures the current WebGL frame as a PNG and triggers a browser download.
 * Attempts a 2x resolution capture first (temporarily resizing the canvas),
 * falling back to 1x if that fails.
 *
 * This is a regular React component (NOT an R3F component). Mount it outside
 * the Canvas as an overlay.
 */

import { useCallback } from "react";
import { Camera } from "lucide-react";

interface ScreenshotButtonProps {
  /** Ref to the underlying HTMLCanvasElement from the R3F Canvas. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Optional filename (without extension). Default: "foampilot-screenshot". */
  filename?: string;
  /** CSS class applied to the button. */
  className?: string;
}

function triggerDownload(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `${filename}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function ScreenshotButton({
  canvasRef,
  filename = "foampilot-screenshot",
  className,
}: ScreenshotButtonProps) {
  const handleClick = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Try 2x resolution capture
    try {
      const origWidth = canvas.width;
      const origHeight = canvas.height;
      const origStyleWidth = canvas.style.width;
      const origStyleHeight = canvas.style.height;

      // Temporarily double the canvas resolution
      canvas.width = origWidth * 2;
      canvas.height = origHeight * 2;
      canvas.style.width = `${origWidth}px`;
      canvas.style.height = `${origHeight}px`;

      // Force a render at the new resolution by reading the context
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (gl) {
        gl.viewport(0, 0, canvas.width, canvas.height);
      }

      // Capture — use preserveDrawingBuffer-compatible approach
      const dataUrl = canvas.toDataURL("image/png");

      // Restore original size
      canvas.width = origWidth;
      canvas.height = origHeight;
      canvas.style.width = origStyleWidth;
      canvas.style.height = origStyleHeight;

      if (gl) {
        gl.viewport(0, 0, origWidth, origHeight);
      }

      if (dataUrl && dataUrl.length > 100) {
        triggerDownload(dataUrl, filename);
        return;
      }
    } catch {
      // Fall through to 1x capture
    }

    // Fallback: 1x capture
    try {
      const dataUrl = canvas.toDataURL("image/png");
      if (dataUrl && dataUrl.length > 100) {
        triggerDownload(dataUrl, filename);
      }
    } catch (err) {
      console.error("Screenshot capture failed:", err);
    }
  }, [canvasRef, filename]);

  return (
    <button
      onClick={handleClick}
      title="Save screenshot"
      className={className}
      style={{
        background: "rgba(30, 30, 30, 0.8)",
        border: "1px solid var(--border)",
        borderRadius: 2,
        color: "var(--fg)",
        padding: "4px 6px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <Camera size={14} />
    </button>
  );
}
