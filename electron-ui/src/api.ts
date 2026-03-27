import type { AppConfig, Template, JobResponse, MeshQuality, AeroResults, CaseInfo, FieldData, AeroSuggestions, GeometryClassification, YPlusResult, ReynoldsResult } from "./types";

let config: AppConfig = {
  backendUrl: "http://localhost:8000",
  localCasesPath: "",
  paraViewPath: "",
  cores: 10,
};

export function setConfig(c: AppConfig) { config = c; }
export function getConfig() { return config; }

const api = (path: string) => `${config.backendUrl}${path}`;

export async function fetchTemplates(): Promise<Template[]> {
  const res = await fetch(api("/templates"));
  if (!res.ok) throw new Error(`Failed to fetch templates: ${res.statusText}`);
  return res.json();
}

export async function createCase(name: string, template: string): Promise<void> {
  const res = await fetch(api("/cases"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, template }),
  });
  if (!res.ok) throw new Error(`Failed to create case: ${res.statusText}`);
}

export async function deleteCase(name: string): Promise<void> {
  const res = await fetch(api(`/cases/${name}`), { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete case: ${res.statusText}`);
}

export async function listCases(): Promise<CaseInfo[]> {
  const res = await fetch(api("/cases"));
  if (!res.ok) throw new Error(`Failed to list cases: ${res.statusText}`);
  return res.json();
}

export async function readFile(caseName: string, filePath: string): Promise<string> {
  const res = await fetch(api(`/cases/${caseName}/file?path=${encodeURIComponent(filePath)}`));
  if (!res.ok) throw new Error(`Failed to read file: ${res.statusText}`);
  const data = await res.json();
  return data.content;
}

export async function writeFile(caseName: string, filePath: string, content: string): Promise<void> {
  const res = await fetch(api(`/cases/${caseName}/file?path=${encodeURIComponent(filePath)}`), {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: content,
  });
  if (!res.ok) throw new Error(`Failed to write file: ${res.statusText}`);
}

export async function runCommands(caseName: string, commands: string[]): Promise<JobResponse> {
  const res = await fetch(api("/run"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ case_name: caseName, commands }),
  });
  if (!res.ok) throw new Error(`Failed to run commands: ${res.statusText}`);
  return res.json();
}

export async function getJobStatus(jobId: string): Promise<{ status: string; exit_code?: number }> {
  const res = await fetch(api(`/jobs/${jobId}`));
  if (!res.ok) throw new Error(`Failed to get job status: ${res.statusText}`);
  return res.json();
}

export async function cancelJob(jobId: string): Promise<void> {
  await fetch(api(`/jobs/${jobId}/cancel`), { method: "POST" });
}

export async function getMeshQuality(caseName: string): Promise<MeshQuality> {
  const res = await fetch(api(`/cases/${caseName}/mesh-quality`));
  if (!res.ok) throw new Error(`Failed to get mesh quality: ${res.statusText}`);
  return res.json();
}

export async function getResults(caseName: string): Promise<AeroResults> {
  const res = await fetch(api(`/cases/${caseName}/results`));
  if (!res.ok) throw new Error(`Failed to get results: ${res.statusText}`);
  return res.json();
}

export async function uploadGeometry(
  caseName: string,
  file: File,
  scale: number = 1.0,
): Promise<{
  filename: string;
  triangles: number;
  bounds: { min: number[]; max: number[] };
}> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("scale", scale.toString());
  const res = await fetch(api(`/cases/${caseName}/upload-geometry`), {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(`Failed to upload geometry: ${res.statusText}`);
  return res.json();
}

export async function getFieldData(
  caseName: string,
  field: string = "p",
  time: string = "latest",
): Promise<FieldData> {
  const res = await fetch(
    api(`/cases/${caseName}/field-data?field=${encodeURIComponent(field)}&time=${encodeURIComponent(time)}`),
  );
  if (!res.ok) throw new Error(`Failed to get field data: ${res.statusText}`);
  return res.json();
}

export async function classifyGeometry(caseName: string): Promise<GeometryClassification> {
  const res = await fetch(api(`/cases/${caseName}/classify`));
  if (!res.ok) throw new Error(`Failed to classify geometry: ${res.statusText}`);
  return res.json();
}

export async function getSuggestions(
  caseName: string,
  velocity: number = 20,
  geometryClass?: string,
): Promise<AeroSuggestions> {
  let url = `/cases/${caseName}/suggest?velocity=${velocity}`;
  if (geometryClass) url += `&geometry_class=${geometryClass}`;
  const res = await fetch(api(url));
  if (!res.ok) throw new Error(`Failed to get suggestions: ${res.statusText}`);
  return res.json();
}

export async function getYPlus(
  caseName: string,
  velocity: number = 20,
  yPlusTarget: number = 30,
): Promise<YPlusResult> {
  const res = await fetch(api(`/cases/${caseName}/y-plus?velocity=${velocity}&y_plus_target=${yPlusTarget}`));
  if (!res.ok) throw new Error(`Failed to calculate y+: ${res.statusText}`);
  return res.json();
}

export async function getReynolds(
  caseName: string,
  velocity: number = 20,
): Promise<ReynoldsResult> {
  const res = await fetch(api(`/cases/${caseName}/reynolds?velocity=${velocity}`));
  if (!res.ok) throw new Error(`Failed to calculate Re: ${res.statusText}`);
  return res.json();
}

export function connectLogs(jobId: string, onLine: (line: string, stream: string) => void): WebSocket {
  const wsUrl = config.backendUrl.replace("http", "ws");
  const ws = new WebSocket(`${wsUrl}/logs/${jobId}`);
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      onLine(msg.line ?? "", msg.stream ?? "stdout");
    } catch {}
  };
  return ws;
}
