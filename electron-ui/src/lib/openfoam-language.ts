import type { languages } from "monaco-editor";

/**
 * OpenFOAM dictionary syntax definition for Monaco editor.
 * Covers FoamFile headers, keywords, boundary types, numeric values,
 * dimension sets, includes, and C-style comments.
 */

export const OPENFOAM_LANG_ID = "openfoam";

export const languageConfig: languages.LanguageConfiguration = {
  comments: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
  },
  brackets: [
    ["{", "}"],
    ["(", ")"],
    ["[", "]"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "(", close: ")" },
    { open: "[", close: "]" },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "(", close: ")" },
    { open: "[", close: "]" },
    { open: '"', close: '"' },
  ],
};

export const monarchTokens: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".foam",

  // OpenFOAM keywords
  keywords: [
    "FoamFile", "version", "format", "class", "object", "location",
    "convertToMeters", "vertices", "blocks", "edges", "boundary",
    "mergePatchPairs", "patches", "defaultPatch",
    // snappyHexMesh
    "castellatedMesh", "snap", "addLayers", "geometry", "castellatedMeshControls",
    "snapControls", "addLayersControls", "meshQualityControls",
    "refinementSurfaces", "refinementRegions", "features", "locationInMesh",
    "maxLocalCells", "maxGlobalCells", "minRefinementCells", "nCellsBetweenLevels",
    "resolveFeatureAngle", "allowFreeStandingZoneFaces",
    // Boundary types
    "type", "value", "uniform", "nonuniform",
    "internalField", "boundaryField", "dimensions",
    // Solver settings
    "application", "startFrom", "startTime", "stopAt", "endTime",
    "deltaT", "writeControl", "writeInterval", "purgeWrite",
    "writeFormat", "writePrecision", "writeCompression",
    "timeFormat", "timePrecision", "runTimeModifiable",
    "adjustTimeStep", "maxCo", "maxDeltaT",
    // fvSchemes
    "ddtSchemes", "gradSchemes", "divSchemes", "laplacianSchemes",
    "interpolationSchemes", "snGradSchemes", "fluxRequired",
    // fvSolution
    "solvers", "SIMPLE", "PISO", "PIMPLE",
    "residualControl", "nNonOrthogonalCorrectors", "nCorrectors",
    "pRefCell", "pRefValue", "consistent",
    "relaxationFactors", "equations", "fields",
    // decomposePar
    "numberOfSubdomains", "method", "coeffs",
    "scotchCoeffs", "hierarchicalCoeffs", "simpleCoeffs",
    // surfaceFeatureExtract
    "extractionMethod", "extractFromSurface", "includedAngle",
  ],

  // Boundary condition types
  bcTypes: [
    "fixedValue", "zeroGradient", "empty", "symmetryPlane", "symmetry",
    "slip", "noSlip", "fixedFluxPressure", "freestreamPressure",
    "freestream", "inletOutlet", "outletInlet", "pressureInletOutletVelocity",
    "totalPressure", "turbulentIntensityKineticEnergyInlet",
    "turbulentMixingLengthDissipationRateInlet",
    "turbulentMixingLengthFrequencyInlet",
    "fixedGradient", "calculated", "epsilonWallFunction",
    "kqRWallFunction", "nutkWallFunction", "omegaWallFunction",
    "nutUSpaldingWallFunction", "nutLowReWallFunction",
    "wall", "patch", "inlet", "outlet",
  ],

  // Solver names
  solverNames: [
    "PCG", "PBiCGStab", "PBiCG", "smoothSolver", "GAMG",
    "diagonal", "DIC", "DILU", "FDIC",
    "GaussSeidel", "symGaussSeidel", "DICGaussSeidel",
    // Schemes
    "Euler", "steadyState", "CrankNicolson", "backward",
    "Gauss", "linear", "linearUpwind", "upwind", "limitedLinear",
    "vanLeer", "MUSCL", "limitedCubic",
    "corrected", "limited", "uncorrected", "orthogonal",
    "cellLimited", "faceLimited",
  ],

  // Boolean values
  booleans: ["true", "false", "yes", "no", "on", "off"],

  tokenizer: {
    root: [
      // Comments
      [/\/\/.*$/, "comment"],
      [/\/\*/, "comment", "@comment"],

      // #include directives
      [/#\w+/, "keyword.directive"],
      [/#include\s+"[^"]*"/, "keyword.directive"],

      // Dimension set [0 2 -1 0 0 0 0]
      [/\[\s*[\d\s.\-e]+\]/, "number.dimension"],

      // Strings
      [/"[^"]*"/, "string"],

      // Numbers (scientific notation, negative, decimal)
      [/-?\d+\.?\d*[eE][+-]?\d+/, "number.float"],
      [/-?\d+\.\d*/, "number.float"],
      [/-?\d+/, "number"],

      // Identifiers
      [/[a-zA-Z_]\w*/, {
        cases: {
          "@keywords": "keyword",
          "@bcTypes": "type",
          "@solverNames": "type.solver",
          "@booleans": "constant.boolean",
          "@default": "identifier",
        },
      }],

      // Delimiters
      [/[{}()\[\]]/, "delimiter.bracket"],
      [/;/, "delimiter"],

      // Wildcards and regex-like patterns in OpenFOAM
      [/"?\.\*"?/, "regexp"],
    ],

    comment: [
      [/[^/*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[/*]/, "comment"],
    ],
  },
};

/**
 * VS Code Dark+ inspired theme for OpenFOAM files
 */
export const openfoamTheme: { base: "vs-dark"; inherit: boolean; rules: { token: string; foreground?: string; fontStyle?: string }[]; colors: Record<string, string> } = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6A9955", fontStyle: "italic" },
    { token: "keyword", foreground: "569CD6" },
    { token: "keyword.directive", foreground: "C586C0" },
    { token: "string", foreground: "CE9178" },
    { token: "number", foreground: "B5CEA8" },
    { token: "number.float", foreground: "B5CEA8" },
    { token: "number.dimension", foreground: "DCDCAA" },
    { token: "type", foreground: "4EC9B0" },
    { token: "type.solver", foreground: "4EC9B0" },
    { token: "constant.boolean", foreground: "569CD6" },
    { token: "identifier", foreground: "9CDCFE" },
    { token: "delimiter", foreground: "D4D4D4" },
    { token: "delimiter.bracket", foreground: "FFD700" },
    { token: "regexp", foreground: "D16969" },
  ],
  colors: {
    "editor.background": "#1e1e1e",
    "editor.foreground": "#d4d4d4",
    "editorLineNumber.foreground": "#858585",
    "editorLineNumber.activeForeground": "#c6c6c6",
    "editor.selectionBackground": "#264f78",
    "editor.lineHighlightBackground": "#2a2d2e",
    "editorCursor.foreground": "#aeafad",
    "editorIndentGuide.background": "#404040",
  },
};

/**
 * Register the OpenFOAM language with Monaco.
 * Call this once before rendering any Editor component.
 */
export function registerOpenFOAMLanguage(monaco: typeof import("monaco-editor")) {
  // Only register once
  if (monaco.languages.getLanguages().some((l) => l.id === OPENFOAM_LANG_ID)) return;

  monaco.languages.register({ id: OPENFOAM_LANG_ID });
  monaco.languages.setLanguageConfiguration(OPENFOAM_LANG_ID, languageConfig);
  monaco.languages.setMonarchTokensProvider(OPENFOAM_LANG_ID, monarchTokens);
  monaco.editor.defineTheme("openfoam-dark", openfoamTheme);
}
