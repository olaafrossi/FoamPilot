export interface AppConfig {
  backendUrl: string;
  localCasesPath: string;
  paraViewPath: string;
  cores: number;
}

export interface Template {
  name: string;
  path: string;
  description: string;
  steps: TemplateStep[];
}

export interface TemplateStep {
  name: string;
  commands: string[];
  files: string[];
}

export interface WizardState {
  currentStep: number;
  caseName: string | null;
  templateName: string | null;
  isCustomSTL: boolean;
  stlFileName: string | null;
  meshComplete: boolean;
  solverComplete: boolean;
}

export interface MeshQuality {
  cells: number;
  faces: number;
  points: number;
  max_non_orthogonality: number;
  max_skewness: number;
  max_aspect_ratio: number;
  ok: boolean;
  errors: string[];
}

export interface AeroResults {
  cd: number | null;
  cl: number | null;
  cm: number | null;
  cd_pressure: number | null;
  cd_viscous: number | null;
  iterations: number;
  wall_time_seconds: number;
  converged: boolean;
}

export interface JobResponse {
  job_id: string;
  case_name: string;
  status: string;
}

export interface CaseInfo {
  name: string;
  modified: string;
  size_bytes: number;
  has_mesh: boolean;
  has_results: boolean;
}

// Electron preload API
declare global {
  interface Window {
    foamPilot: {
      getConfig: () => Promise<AppConfig>;
      openParaView: (casePath: string) => Promise<{ ok: boolean; error?: string }>;
      openFolder: (folderPath: string) => Promise<void>;
      selectFile: (filters: { name: string; extensions: string[] }[]) => Promise<string | null>;
      readFile: (filePath: string) => Promise<ArrayBuffer>;
    };
  }
}
