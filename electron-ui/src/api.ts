import type { AppConfig, Template, JobResponse, MeshQuality, AeroResults, CaseInfo, FieldData, AeroSuggestions, GeometryClassification, YPlusResult, ReynoldsResult } from "./types";

let config: AppConfig = {
  backendUrl: "http://127.0.0.1:8000",
  localCasesPath: "",
  paraViewPath: "",
  cores: 4,
  dockerCpus: 4,
  dockerMemory: 8,
};

export function setConfig(c: AppConfig) { config = c; }
export function getConfig() { return config; }

/**
 * Fetch the backend's /config endpoint and sync cores (FOAM_CORES env var)
 * into the local config. Returns the backend-reported cores value.
 */
export async function syncCoresFromBackend(): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(api("/config"), { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data.cores === "number" && data.cores >= 1) {
      config = { ...config, cores: data.cores };
      return data.cores;
    }
    return null;
  } catch {
    return null;
  }
}

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
  if (data.content === null) throw new Error(`File not found: ${filePath}`);
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
  template: string = "motorBike",
): Promise<{
  filename: string;
  triangles: number;
  bounds: { min: number[]; max: number[] };
}> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("scale", scale.toString());
  formData.append("template", template);
  const res = await fetch(api(`/cases/${caseName}/upload-geometry`), {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(`Failed to upload geometry: ${res.statusText}`);
  return res.json();
}

export async function transformGeometry(
  caseName: string,
  transform: {
    rotate_x?: number;
    rotate_y?: number;
    rotate_z?: number;
    translate_x?: number;
    translate_y?: number;
    translate_z?: number;
  },
): Promise<{
  filename: string;
  triangles: number;
  bounds: { min: number[]; max: number[] };
  y_stats?: { min: number; max: number; bbox_center: number; centroid: number; median: number };
}> {
  const res = await fetch(api(`/cases/${caseName}/transform-geometry`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(transform),
  });
  if (!res.ok) throw new Error(`Failed to transform geometry: ${res.statusText}`);
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
  if (!res.ok) {
    const detail = await res.json().then(j => j.detail).catch(() => res.statusText);
    throw new Error(`Failed to get field data: ${detail}`);
  }
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

// ---------------------------------------------------------------------------
// Slice plane data
// ---------------------------------------------------------------------------

export interface SliceData {
  vertices: number[][];
  faces: number[][];
  values: number[];
  min: number;
  max: number;
  field: string;
  axis: string;
  position: number;
  message?: string;
}

export async function getSliceData(
  caseName: string,
  field: string,
  time: string,
  axis: string,
  position: number,
): Promise<SliceData> {
  const params = new URLSearchParams({
    field,
    time,
    axis,
    position: String(position),
  });
  const res = await fetch(
    api(`/cases/${caseName}/slice?${params.toString()}`),
  );
  if (!res.ok) throw new Error(`Failed to get slice data: ${res.statusText}`);
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
