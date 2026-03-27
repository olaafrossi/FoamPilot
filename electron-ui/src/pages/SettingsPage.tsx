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
      <h1 style={{ fontSize: 20, fontWeight: 600, color: "#ffffff", marginBottom: 24 }}>Settings</h1>
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
          className="bg-[#0e639c] hover:bg-[#1177bb] text-white px-6 py-2 rounded-sm font-semibold text-[13px]"
        >
          Save Settings
        </button>
        {saved && (
          <span className="text-[#89d185] text-[13px]">Settings saved</span>
        )}
      </div>
      <p className="text-[13px] text-[#858585] mt-4">
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
    <div className="bg-[#252526] border border-[#474747] p-4" style={{ borderRadius: 0 }}>
      <label className="text-[13px] text-[#858585] block mb-2">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#3c3c3c] border border-[#474747] text-[#cccccc] font-mono text-[13px] px-3 py-1.5 focus:border-[#0078d4] focus:outline-none"
        style={{ borderRadius: 0 }}
      />
    </div>
  );
}
