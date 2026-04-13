import { useEffect, useRef, useCallback } from "react";

interface ConfettiProps {
  stage: number;
  isLoading: boolean;
}

const COLORS = ["#E31837", "#006491", "#FFD700", "#ff6b6b", "#48dbfb"];

function getSegmentOrigin(stage: number): { x: number; y: number } {
  const el = document.querySelector(`[data-stage="${stage}"]`);
  if (!el) return { x: 0.5, y: 0.5 };
  const rect = el.getBoundingClientRect();
  return {
    x: (rect.left + rect.width / 2) / window.innerWidth,
    y: (rect.top + rect.height / 2) / window.innerHeight,
  };
}

export function Confetti({ stage, isLoading }: ConfettiProps) {
  const prevStage = useRef<number | null>(null);
  const isFirstRender = useRef(true);
  const pourInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingConfetti = useRef<{ stage: number } | null>(null);

  const fireSegmentBurst = useCallback((s: number) => {
    if (typeof window.confetti !== "function") return;
    const origin = getSegmentOrigin(s);
    window.confetti({ particleCount: 80, spread: 70, origin, colors: COLORS });
  }, []);

  const startPour = useCallback((s: number) => {
    if (pourInterval.current || typeof window.confetti !== "function") return;
    fireSegmentBurst(s);
    pourInterval.current = setInterval(() => {
      const origin = getSegmentOrigin(s);
      window.confetti?.({ particleCount: 4, spread: 360, startVelocity: 15, origin, colors: COLORS });
    }, 150);
  }, [fireSegmentBurst]);

  const stopPour = useCallback(() => {
    if (pourInterval.current) {
      clearInterval(pourInterval.current);
      pourInterval.current = null;
    }
  }, []);

  const fireConfetti = useCallback((s: number) => {
    fireSegmentBurst(s);
    if (s === 5) startPour(s);
  }, [fireSegmentBurst, startPour]);

  const queueConfetti = useCallback((s: number) => {
    if (document.hasFocus()) {
      fireConfetti(s);
    } else {
      pendingConfetti.current = { stage: s };
    }
  }, [fireConfetti]);

  // Flush pending confetti when tab becomes visible
  useEffect(() => {
    const flush = () => {
      if (pendingConfetti.current) {
        fireConfetti(pendingConfetti.current.stage);
        pendingConfetti.current = null;
      }
    };
    const onVisChange = () => { if (!document.hidden) flush(); };
    document.addEventListener("visibilitychange", onVisChange);
    window.addEventListener("focus", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
      window.removeEventListener("focus", flush);
    };
  }, [fireConfetti]);

  useEffect(() => {
    if (isLoading || typeof window.confetti !== "function") return;

    const stageChanged =
      !isFirstRender.current &&
      prevStage.current !== null &&
      prevStage.current !== stage;

    if (stageChanged) {
      stopPour();
      queueConfetti(stage);
    }

    // Stage 5: continuous confetti on every load (including page refresh)
    if (stage === 5 && !pourInterval.current) {
      queueConfetti(5);
    }

    isFirstRender.current = false;
    prevStage.current = stage;

    return () => {
      stopPour();
    };
  }, [stage, isLoading, queueConfetti, stopPour]);

  return null;
}

// Type augmentation for canvas-confetti global
declare global {
  interface Window {
    confetti: ((options?: Record<string, unknown>) => void) | undefined;
  }
}
