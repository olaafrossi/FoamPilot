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
  difficulty?: string;
  solver?: string;
  source?: string;
  domain_type?: string;
  has_geometry?: boolean;
  category?: string;
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

export interface FieldData {
  vertices: number[][];     // [[x,y,z], ...]
  faces: number[][];        // [[i,j,k], ...] triangulated
  values: number[];         // one scalar per vertex
  vectors?: number[][];     // [[vx,vy,vz], ...] for vector fields
  min: number;
  max: number;
  field: string;
  time: string;
  patches: { name: string; startFace: number; nFaces: number }[];
  warning?: string | null;
}

export interface GeometryClassification {
  geometry_class: "streamlined" | "bluff" | "complex";
  characteristic_length: number;
  frontal_area: number;
  wetted_area_estimate: number;
  aspect_ratio: number;
  description: string;
  warning: string | null;
}

export interface MeshSuggestion {
  domain_multiplier_upstream: number;
  domain_multiplier_downstream: number;
  domain_multiplier_side: number;
  domain_multiplier_top: number;
  surface_refinement_min: number;
  surface_refinement_max: number;
  feature_level: number;
  region_refinement_level: number;
  n_surface_layers: number;
  expansion_ratio: number;
  first_layer_height: number | null;
  y_plus_target: number;
  estimated_cells: number;
  rationale: string;
}

export interface PhysicsSuggestion {
  reynolds_number: number;
  turbulence_model: string;
  turbulence_model_rationale: string;
  freestream_k: number;
  freestream_omega: number;
  freestream_nut: number;
  inlet_velocity: number[];
}

export interface SolverSuggestion {
  solver_name: string;
  end_time: number;
  write_interval: number;
  convergence_target: number;
  rationale: string;
}

export interface ConvergencePrediction {
  expected_iterations: number;
  confidence: "low" | "medium" | "high";
  risk_factors: string[];
  status: string;
}

export interface AeroSuggestions {
  geometry: GeometryClassification;
  mesh: MeshSuggestion;
  physics: PhysicsSuggestion;
  solver: SolverSuggestion;
  convergence: ConvergencePrediction;
}

export interface YPlusResult {
  first_cell_height: number | null;
  re: number;
  cf: number;
  u_tau: number;
  y_plus_target: number;
  characteristic_length: number;
  message: string | null;
}

export interface ReynoldsResult {
  reynolds_number: number;
  velocity: number;
  characteristic_length: number;
  kinematic_viscosity: number;
  regime: "laminar" | "transitional" | "turbulent";
}

// Docker & Update types
export interface DockerFullStatus {
  installed: boolean;
  version?: string;
  running?: boolean;
  composeAvailable?: boolean;
  container?: "running" | "stopped" | "not_found" | "unhealthy";
}

export interface ContainerUpdateInfo {
  available: boolean;
  current: string;
  latest: string;
}

export interface UpdateCheckResult {
  container: ContainerUpdateInfo | null;
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
      showNotification: (title: string, body: string) => Promise<boolean>;

      docker: {
        getStatus: () => Promise<DockerFullStatus>;
        pull: (tag?: string) => Promise<{ ok: boolean; error?: string }>;
        start: () => Promise<{ ok: boolean; healthy?: boolean; error?: string }>;
        stop: () => Promise<{ ok: boolean; error?: string }>;
        ensureSetup: () => Promise<{ ok: boolean; error?: string }>;
        healthCheck: () => Promise<boolean>;
        onProgress: (cb: (msg: string) => void) => () => void;
        onStatusChange: (cb: (status: any) => void) => () => void;
      };

      updates: {
        check: () => Promise<UpdateCheckResult>;
        applyContainer: (tag: string) => Promise<{ ok: boolean; error?: string }>;
        getAppVersion: () => Promise<string>;
        onAvailable: (cb: (info: any) => void) => () => void;
        onDownloaded: (cb: (info: any) => void) => () => void;
      };
    };
  }
}
