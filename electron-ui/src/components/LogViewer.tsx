import { useEffect, useRef, useCallback } from "react";

interface LogViewerProps {
  lines: string[];
  height?: string;
}

// Patterns for syntax coloring OpenFOAM log output
const LINE_RULES: Array<{
  test: RegExp;
  className: string;
}> = [
  // Errors / warnings
  { test: /\b(FOAM FATAL ERROR|FATAL|ERROR|error)\b/i, className: "text-[#f48771]" },
  { test: /\b(WARNING|warning|Warning)\b/, className: "text-[#cca700]" },
  // Solver convergence line: "Solving for Ux, Initial residual = ..."
  { test: /Solving for \w+/, className: "" }, // handled by span coloring below
  // Time step header
  { test: /^Time = \d+/, className: "text-[#569cd6] font-semibold" },
  // Mesh quality
  { test: /Mesh OK/, className: "text-[#89d185] font-semibold" },
  { test: /\*\*\*/, className: "text-[#f48771]" },
];

// Token-level coloring within a line
function colorLine(line: string): React.ReactNode {
  // Check full-line rules first
  for (const rule of LINE_RULES) {
    if (rule.test.test(line) && rule.className) {
      return <span className={rule.className}>{line}</span>;
    }
  }

  // Solver residual line — color field name and numbers
  const solverMatch = line.match(
    /^(.*?)(Solving for )(\w+)(, Initial residual = )([0-9.eE+-]+)(, Final residual = )([0-9.eE+-]+)(.*)/,
  );
  if (solverMatch) {
    return (
      <>
        {solverMatch[1]}
        {solverMatch[2]}
        <span className="text-[#4ec9b0] font-semibold">{solverMatch[3]}</span>
        {solverMatch[4]}
        <span className="text-[#b5cea8]">{solverMatch[5]}</span>
        {solverMatch[6]}
        <span className="text-[#b5cea8]">{solverMatch[7]}</span>
        {solverMatch[8]}
      </>
    );
  }

  // Continuity / bounding lines
  const continuityMatch = line.match(
    /^(.*?)(time step continuity errors :.*sum local = )([0-9.eE+-]+)(.*)/,
  );
  if (continuityMatch) {
    return (
      <>
        {continuityMatch[1]}
        {continuityMatch[2]}
        <span className="text-[#b5cea8]">{continuityMatch[3]}</span>
        {continuityMatch[4]}
      </>
    );
  }

  // Numeric values at end of key = value patterns
  const kvMatch = line.match(/^(\s*\w[\w\s]*?= )([0-9.eE+-]+)(.*)$/);
  if (kvMatch) {
    return (
      <>
        {kvMatch[1]}
        <span className="text-[#b5cea8]">{kvMatch[2]}</span>
        {kvMatch[3]}
      </>
    );
  }

  return line;
}

export default function LogViewer({ lines, height = "256px" }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  // Detect whether user has scrolled away from bottom
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    userScrolledRef.current = !atBottom;
  }, []);

  // Auto-scroll only when user hasn't scrolled up
  useEffect(() => {
    if (!userScrolledRef.current) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines]);

  const gutterWidth = lines.length > 0
    ? `${Math.max(3, String(lines.length).length)}ch`
    : "3ch";

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="border border-[#474747] overflow-y-auto font-mono text-[13px] leading-[20px] text-[#cccccc] select-text"
      style={{ background: "var(--bg-editor)", borderRadius: 0, height }}
    >
      <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: `calc(${gutterWidth} + 24px)` }} />
          <col />
        </colgroup>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="hover:bg-[#2a2d2e]">
              <td
                className="text-right pr-3 pl-2 select-none text-[#858585] align-top"
                style={{
                  width: `calc(${gutterWidth} + 24px)`,
                  borderRight: "1px solid #333333",
                  userSelect: "none",
                }}
              >
                {i + 1}
              </td>
              <td className="pl-3 pr-2 whitespace-pre-wrap break-all">
                {colorLine(line)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div ref={endRef} />
    </div>
  );
}
