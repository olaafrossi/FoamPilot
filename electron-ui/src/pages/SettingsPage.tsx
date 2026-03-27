import { useState } from "react";
import { getConfig, setConfig } from "../api";
import type { AppConfig } from "../types";

export default function SettingsPage() {
  const [form, setForm] = useState<AppConfig>(() => ({ ...getConfig() }));
  const [saved, setSaved] = useState(false);

  const update = (key: keyof AppConfig, value: string | number) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    setConfig(form);
    // Persist to localStorage so settings survive page reload
    localStorage.setItem("foampilot-config", JSON.stringify(form));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--fg)", marginBottom: 24, fontFamily: "var(--font-display)" }}>Settings</h1>
      <div className="space-y-4">
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
        <SettingInput
          label="CPU Cores (for parallel meshing & solving)"
          value={String(form.cores)}
          type="number"
          onChange={(v) => update("cores", Math.max(1, parseInt(v) || 1))}
        />
      </div>
      <div className="mt-6 flex items-center gap-4">
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
      <p className="text-[13px] mt-4" style={{ color: "var(--fg-muted)" }}>
        Settings are stored in your browser. CPU cores controls how many parallel
        processes OpenFOAM uses for meshing and solving.
      </p>
    </div>
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
