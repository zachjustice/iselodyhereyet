import { useCallback, useEffect, useRef, useState } from "react";
import type { Status } from "../types";

interface UseStatusResult {
  stage: number;
  updatedAt: number;
  message: string;
  isLoading: boolean;
}

const STAGE_MESSAGES: Record<number, string> = {
  1: "Katie began preparing your order 9 months ago",
  2: "Katie began preparing your order 9 months ago",
  3: "Katie began preparing your order 9 months ago",
  4: "Katie began preparing your order 9 months ago",
  5: "Zach has the best wife ever",
};

export function useStatus(pollInterval = 30000): UseStatusResult {
  const [status, setStatus] = useState<Status | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const latestUpdatedAt = useRef<number>(0);

  const fetchStatus = useCallback(() => {
    fetch(`status.json?t=${Date.now()}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch status");
        return res.json() as Promise<Status>;
      })
      .then((data) => {
        if (data.updatedAt > latestUpdatedAt.current) {
          latestUpdatedAt.current = data.updatedAt;
          setStatus(data);
        }
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Error fetching status:", err);
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, pollInterval);
    return () => clearInterval(id);
  }, [fetchStatus, pollInterval]);

  // Listen for push updates from service worker
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handler = (event: MessageEvent) => {
      if (event.data?.type === "push-update") {
        const pushData = event.data.data as Status | undefined;
        if (pushData?.stage && pushData?.updatedAt) {
          latestUpdatedAt.current = pushData.updatedAt;
          setStatus(pushData);
        } else {
          fetchStatus();
        }
      }
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handler);
  }, [fetchStatus]);

  const stage = status?.stage ?? 1;

  return {
    stage,
    updatedAt: status?.updatedAt ?? 0,
    message: STAGE_MESSAGES[stage] ?? "",
    isLoading,
  };
}
