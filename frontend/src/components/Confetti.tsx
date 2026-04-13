import { useEffect, useRef } from "react";

interface ConfettiProps {
  stage: number;
  isLoading: boolean;
}

export function Confetti({ stage, isLoading }: ConfettiProps) {
  const prevStage = useRef<number | null>(null);
  const isFirstRender = useRef(true);
  const pourInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isLoading || typeof window.confetti !== "function") return;

    const stageChanged =
      !isFirstRender.current &&
      prevStage.current !== null &&
      prevStage.current !== stage;

    // Burst confetti on stage change
    if (stageChanged) {
      window.confetti?.({
        particleCount: 80,
        spread: 70,
        origin: { x: 0.5, y: 0.5 },
        colors: ["#E31837", "#006491", "#FFD700", "#ff6b6b", "#48dbfb"],
      });
    }

    // Continuous pour on stage 5
    if (stage === 5 && !pourInterval.current) {
      // Initial burst
      window.confetti?.({
        particleCount: 80,
        spread: 70,
        origin: { x: 0.5, y: 0.5 },
        colors: ["#E31837", "#006491", "#FFD700", "#ff6b6b", "#48dbfb"],
      });

      pourInterval.current = setInterval(() => {
        window.confetti?.({
          particleCount: 4,
          spread: 360,
          startVelocity: 15,
          origin: { x: 0.5, y: 0.5 },
          colors: ["#E31837", "#006491", "#FFD700", "#ff6b6b", "#48dbfb"],
        });
      }, 150);
    }

    isFirstRender.current = false;
    prevStage.current = stage;

    return () => {
      if (pourInterval.current) {
        clearInterval(pourInterval.current);
        pourInterval.current = null;
      }
    };
  }, [stage, isLoading]);

  return null;
}

// Type augmentation for canvas-confetti global
declare global {
  interface Window {
    confetti: ((options?: Record<string, unknown>) => void) | undefined;
  }
}
