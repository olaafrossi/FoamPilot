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
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#ffffff" }}>My Simulations</h1>
        <button
          onClick={loadCases}
          className="flex items-center gap-2 px-3 py-1.5 text-[13px] bg-transparent border border-[#474747] text-[#cccccc] hover:bg-[#2a2d2e] rounded-sm transition-colors"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-[#858585] text-[13px]">Loading cases...</p>
      ) : cases.length === 0 ? (
        <div className="text-center py-16 text-[#858585]">
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>No simulations yet</p>
          <p style={{ fontSize: 13 }}>Start a new simulation from the wizard.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {cases.map((c) => (
            <div
              key={c.name}
              className="flex items-center justify-between bg-[#252526] border border-[#474747] p-4 hover:border-[#858585] transition-colors"
              style={{ borderRadius: 0 }}
            >
              <div>
                <h3 className="font-semibold text-[13px] text-[#cccccc]">{c.name}</h3>
                <p className="text-[13px] text-[#858585]">
                  Modified: {new Date(c.modified).toLocaleDateString()} ·{" "}
                  {(c.size_bytes / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleOpen(c.name)}
                  className="p-2 text-[#858585] hover:text-[#3794ff] hover:bg-[#2a2d2e]"
                  style={{ borderRadius: 0 }}
                >
                  <FolderOpen size={18} />
                </button>
                <button
                  onClick={() => handleDelete(c.name)}
                  className="p-2 text-[#858585] hover:text-[#f48771] hover:bg-[#2a2d2e]"
                  style={{ borderRadius: 0 }}
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
