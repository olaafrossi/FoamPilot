import { useState, useCallback } from "react";
import WizardStepper from "../components/WizardStepper";
import GeometryStep from "../steps/GeometryStep";
import MeshStep from "../steps/MeshStep";
import PhysicsStep from "../steps/PhysicsStep";
import SolverStep from "../steps/SolverStep";
import RunStep from "../steps/RunStep";
import ResultsStep from "../steps/ResultsStep";

export default function WizardPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [caseName, setCaseName] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);

  const completeStep = useCallback((step: number) => {
    setCompletedSteps((prev) => new Set([...prev, step]));
  }, []);

  const goNext = useCallback(() => {
    completeStep(currentStep);
    setCurrentStep((s) => Math.min(s + 1, 5));
  }, [currentStep, completeStep]);

  const goBack = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }, []);

  const resetWizard = useCallback(() => {
    setCurrentStep(0);
    setCompletedSteps(new Set());
    setCaseName(null);
    setTemplateName(null);
  }, []);

  const stepProps = { caseName, setCaseName, templateName, setTemplateName, goNext, goBack, completeStep };

  return (
    <div className="flex flex-col h-full">
      <WizardStepper currentStep={currentStep} completedSteps={completedSteps} />
      <div className="flex-1 overflow-auto px-8 pb-8">
        {currentStep === 0 && <GeometryStep {...stepProps} />}
        {currentStep === 1 && <MeshStep {...stepProps} />}
        {currentStep === 2 && <PhysicsStep {...stepProps} />}
        {currentStep === 3 && <SolverStep {...stepProps} />}
        {currentStep === 4 && <RunStep {...stepProps} />}
        {currentStep === 5 && <ResultsStep {...stepProps} resetWizard={resetWizard} />}
      </div>
    </div>
  );
}
