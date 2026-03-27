import Editor, { type OnMount } from "@monaco-editor/react";
import { registerOpenFOAMLanguage, OPENFOAM_LANG_ID } from "../lib/openfoam-language";

interface FoamEditorProps {
  value: string;
  onChange?: (value: string) => void;
  height?: string | number;
  readOnly?: boolean;
}

/**
 * Monaco editor pre-configured for OpenFOAM dictionary files.
 * Registers the custom language/theme on first mount.
 */
export default function FoamEditor({ value, onChange, height = "400px", readOnly = false }: FoamEditorProps) {
  const handleMount: OnMount = (_editor, monaco) => {
    registerOpenFOAMLanguage(monaco);
    // Re-set model language after registration
    const model = _editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, OPENFOAM_LANG_ID);
    }
  };

  return (
    <Editor
      height={height}
      language={OPENFOAM_LANG_ID}
      theme="openfoam-dark"
      value={value}
      onChange={(v) => onChange?.(v ?? "")}
      onMount={handleMount}
      beforeMount={(monaco) => registerOpenFOAMLanguage(monaco)}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        fontFamily: "Cascadia Code, Consolas, Courier New, monospace",
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        wordWrap: "off",
        automaticLayout: true,
        readOnly,
        renderLineHighlight: "line",
        lineHeight: 21,
        padding: { top: 8 },
        folding: true,
        bracketPairColorization: { enabled: true },
        guides: { indentation: true },
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
      }}
    />
  );
}
