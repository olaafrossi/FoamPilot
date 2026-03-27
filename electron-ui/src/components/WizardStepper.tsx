import { Check } from "lucide-react";

interface Step {
  name: string;
  number: number;
}

const STEPS: Step[] = [
  { name: "Geometry", number: 1 },
  { name: "Mesh", number: 2 },
  { name: "Physics", number: 3 },
  { name: "Solver", number: 4 },
  { name: "Run", number: 5 },
  { name: "Results", number: 6 },
];

interface Props {
  currentStep: number; // 0-indexed
  completedSteps: Set<number>;
}

export default function WizardStepper({ currentStep, completedSteps }: Props) {
  return (
    <div
      className="flex items-center shrink-0"
      style={{
        height: 22,
        background: "var(--bg-editor)",
        padding: "0 32px",
        fontSize: 13,
        fontFamily: "var(--font-ui)",
      }}
    >
      {STEPS.map((step, i) => {
        const isCompleted = completedSteps.has(i);
        const isCurrent = i === currentStep;

        let color = "var(--fg-muted)";
        let fontWeight: number = 400;
        if (isCurrent) {
          color = "var(--accent)";
          fontWeight = 600;
        } else if (isCompleted) {
          color = "var(--success)";
        }

        return (
          <span key={step.number} className="flex items-center">
            {isCompleted && (
              <Check size={12} style={{ color: "var(--success)", marginRight: 2 }} />
            )}
            <span style={{ color, fontWeight }}>{step.name}</span>
            {i < STEPS.length - 1 && (
              <span style={{ color: "var(--fg-muted)", margin: "0 6px" }}>
                ›
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
