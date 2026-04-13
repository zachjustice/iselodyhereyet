import { useEffect, useRef, useState } from "react";

interface UseFunFactsResult {
  currentFact: string;
  progress: number;
}

export function useFunFacts(
  facts: string[],
  rotationInterval = 45000,
): UseFunFactsResult {
  const [index, setIndex] = useState(() => {
    const saved = sessionStorage.getItem("funFactIndex");
    return saved ? parseInt(saved, 10) % facts.length : 0;
  });
  const [progress, setProgress] = useState(0);
  const cycleStart = useRef(performance.now());
  const rafId = useRef<number>(0);

  // Rotation timer
  useEffect(() => {
    if (facts.length === 0) return;

    cycleStart.current = performance.now();

    const id = setInterval(() => {
      setIndex((prev) => {
        const next = (prev + 1) % facts.length;
        sessionStorage.setItem("funFactIndex", String(next));
        return next;
      });
      cycleStart.current = performance.now();
    }, rotationInterval);

    return () => clearInterval(id);
  }, [facts.length, rotationInterval]);

  // Progress animation
  useEffect(() => {
    if (facts.length === 0) return;

    const tick = (now: number) => {
      const elapsed = now - cycleStart.current;
      setProgress(Math.min(elapsed / rotationInterval, 1));
      rafId.current = requestAnimationFrame(tick);
    };

    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, [facts.length, rotationInterval]);

  return {
    currentFact: facts.length > 0 ? facts[index] : "",
    progress,
  };
}
