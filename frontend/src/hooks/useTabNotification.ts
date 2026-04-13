import { useEffect, useRef } from "react";

const STAGE_NAMES: Record<number, string> = {
  1: "We're Home",
  2: "Arrived safely at hospital",
  3: "Labor has started",
  4: "Delivery time",
  5: "She's Here!",
};

const ORIGINAL_TITLE = "Elody's Tracker";
const TADA_FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='80' font-size='80'>🎉</text></svg>";

export function useTabNotification(stage: number, isLoading: boolean): void {
  const prevStage = useRef<number | null>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isLoading) return;

    const faviconEl = document.getElementById("favicon") as HTMLLinkElement;
    const originalFavicon = faviconEl?.href ?? "";

    // Detect stage change (not on first load)
    if (
      !isFirstRender.current &&
      prevStage.current !== null &&
      prevStage.current !== stage
    ) {
      // Flash title if tab is not focused
      if (!document.hasFocus()) {
        let showUpdate = true;
        const interval = setInterval(() => {
          document.title = showUpdate
            ? (STAGE_NAMES[stage] ?? ORIGINAL_TITLE)
            : ORIGINAL_TITLE;
          if (faviconEl) {
            faviconEl.href = showUpdate ? TADA_FAVICON : originalFavicon;
          }
          showUpdate = !showUpdate;
        }, 1000);

        const onFocus = () => {
          clearInterval(interval);
          document.title = ORIGINAL_TITLE;
          if (faviconEl) faviconEl.href = originalFavicon;
          window.removeEventListener("focus", onFocus);
        };
        window.addEventListener("focus", onFocus);

        return () => {
          clearInterval(interval);
          window.removeEventListener("focus", onFocus);
          document.title = ORIGINAL_TITLE;
          if (faviconEl) faviconEl.href = originalFavicon;
        };
      }
    }

    isFirstRender.current = false;
    prevStage.current = stage;
  }, [stage, isLoading]);
}
