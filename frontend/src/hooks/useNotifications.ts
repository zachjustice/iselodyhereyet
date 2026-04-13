import { useCallback, useEffect, useState } from "react";

const VAPID_PUBLIC_KEY =
  "BCNsLq0RdSNFYKjMKvoqyNQPrcuTKfDXpT1fYljKqC4YJguonZAPDEWIBC-XDLBRe8891f4siwa9yg4h-iuX15M";
const SUBSCRIBE_URL =
  "https://iselodyhereyet-sms.lucky-night-372b.workers.dev/subscribe";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

interface UseNotificationsResult {
  isSubscribed: boolean;
  isSupported: boolean;
  isIosNonStandalone: boolean;
  subscribe: () => Promise<void>;
  error: string;
}

export function useNotifications(): UseNotificationsResult {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [error, setError] = useState("");

  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  const isIosNonStandalone = isIos && !isStandalone;

  const isSupported =
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    !isIosNonStandalone;

  // Check existing subscription on mount
  useEffect(() => {
    if (!isSupported) return;

    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (sub) setIsSubscribed(true);
      });
  }, [isSupported]);

  const subscribe = useCallback(async () => {
    setError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Notification permission was denied.");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      const res = await fetch(SUBSCRIBE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });

      if (!res.ok) throw new Error("Server error");
      setIsSubscribed(true);
    } catch (err) {
      console.error("Subscribe failed:", err);
      setError("Failed to subscribe. Try again.");
    }
  }, []);

  return { isSubscribed, isSupported, isIosNonStandalone, subscribe, error };
}
