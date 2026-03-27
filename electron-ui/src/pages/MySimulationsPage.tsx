import { useEffect, useState } from "react";
import { listCases, deleteCase } from "../api";
import { Trash2, FolderOpen, RefreshCw } from "lucide-react";
import type { CaseInfo } from "../types";

export default function MySimulationsPage() {
  const [cases, setCases] = useState<CaseInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCases = async () => {
    setLoading(true);
    try {
      const data = await listCases();
      setCases(Array.isArray(data) ? data : []);
    } catch { setCases([]); }
    setLoading(false);
  };

  useEffect(() => { loadCases(); }, []);

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete case "${name}"? This cannot be undone.`)) return;
    try {
      await deleteCase(name);
      loadCases();
    } catch {}
  };

  const handleOpen = (name: string) => {
    const config = (window as any).__foamConfig;
    if (window.foamPilot?.openFolder && config?.localCasesPath) {
      window.foamPilot.openFolder(`${config.localCasesPath}/${name}`);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--fg)", fontFamily: "var(--font-display)" }}>My Simulations</h1>
        <button
          onClick={loadCases}
          className="flex items-center gap-2 px-3 py-1.5 text-[13px] bg-transparent border rounded-sm transition-colors"
          style={{ borderColor: "var(--border)", color: "var(--fg)" }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>Loading cases...</p>
      ) : cases.length === 0 ? (
        <div className="text-center py-16" style={{ color: "var(--fg-muted)" }}>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>No simulations yet</p>
          <p style={{ fontSize: 13 }}>Start a new simulation from the wizard.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {cases.map((c) => (
            <div
              key={c.name}
              className="flex items-center justify-between p-4 transition-colors"
              style={{
                backgroundColor: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: 0,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--fg-muted)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
            >
              <div>
                <h3 className="font-semibold text-[13px]" style={{ color: "var(--fg)" }}>{c.name}</h3>
                <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>
                  Modified: {new Date(c.modified).toLocaleDateString()} ·{" "}
                  {(c.size_bytes / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleOpen(c.name)}
                  className="p-2"
                  style={{ color: "var(--fg-muted)", borderRadius: 0 }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--fg-muted)"; e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  <FolderOpen size={18} />
                </button>
                <button
                  onClick={() => handleDelete(c.name)}
                  className="p-2"
                  style={{ color: "var(--fg-muted)", borderRadius: 0 }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--error)"; e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--fg-muted)"; e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
