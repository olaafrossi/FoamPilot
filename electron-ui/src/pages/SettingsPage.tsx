import { getConfig } from "../api";

export default function SettingsPage() {
  const config = getConfig();

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 style={{ fontSize: 20, fontWeight: 600, color: "#ffffff", marginBottom: 24 }}>Settings</h1>
      <div className="space-y-4">
        <SettingRow label="Backend URL" value={config.backendUrl} />
        <SettingRow label="Local Cases Path" value={config.localCasesPath} />
        <SettingRow label="ParaView Path" value={config.paraViewPath} />
        <SettingRow label="CPU Cores" value={String(config.cores)} />
      </div>
      <p className="text-[13px] text-[#858585] mt-6">
        Edit settings.json next to the application to change these values.
      </p>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#252526] border border-[#474747] p-4" style={{ borderRadius: 0 }}>
      <label className="text-[13px] text-[#858585] block mb-1">{label}</label>
      <p className="font-mono text-[13px] text-[#cccccc]">{value}</p>
    </div>
  );
}
