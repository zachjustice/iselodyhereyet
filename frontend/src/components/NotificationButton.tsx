import { useState } from "react";

interface NotificationButtonProps {
  isSubscribed: boolean;
  isSupported: boolean;
  isIosNonStandalone: boolean;
  onSubscribe: () => Promise<void>;
  error: string;
}

function getNotificationHint(): string {
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isMac = /Macintosh|Mac OS X/.test(ua);
  const isWindows = /Windows/.test(ua);
  const isAndroid = /Android/.test(ua);

  let browser = "";
  if (/Chrome/.test(ua) && !/Edg/.test(ua)) browser = "Google Chrome";
  else if (/Safari/.test(ua) && !/Chrome/.test(ua)) browser = "Safari";
  else if (/Firefox/.test(ua)) browser = "Firefox";
  else if (/Edg/.test(ua)) browser = "Microsoft Edge";

  if (isIos) {
    return "Make sure notifications are enabled via Settings \u2192 Notifications \u2192 iselodyhereyet.";
  }
  if (isAndroid) {
    return `Make sure notifications are enabled via Settings \u2192 Apps \u2192 ${browser || "your browser"} \u2192 Notifications.`;
  }
  if (isMac && browser) {
    return `Make sure notifications are enabled via System Settings \u2192 Notifications \u2192 ${browser}.`;
  }
  if (isWindows) {
    return `Make sure notifications are enabled via Settings \u2192 Notifications \u2192 ${browser || "your browser"}.`;
  }
  return "Make sure notifications are enabled in your device settings.";
}

export function NotificationButton({
  isSubscribed,
  isSupported,
  isIosNonStandalone,
  onSubscribe,
  error,
}: NotificationButtonProps) {
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem("notifyDismissed") === "1",
  );

  if (dismissed) return null;

  const handleSubscribe = async () => {
    setIsSubscribing(true);
    await onSubscribe();
    setIsSubscribing(false);
  };

  const handleDismiss = () => {
    localStorage.setItem("notifyDismissed", "1");
    setDismissed(true);
  };

  return (
    <div className="max-w-[700px] mx-auto mt-5 py-5 px-6 text-center relative bg-white border border-gray-300 rounded-xl max-[480px]:mx-3">
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-3 bg-transparent border-none text-gray-400 text-xl cursor-pointer px-2 py-1 leading-none hover:text-gray-600 transition-colors"
        aria-label="Dismiss"
      >
        &times;
      </button>

      {isIosNonStandalone ? (
        <div className="text-gray-600 text-sm mt-2.5 leading-relaxed">
          <p>
            To receive <strong>push notifications</strong>, you gotta add this
            page to your home screen.
          </p>
          <p>
            Tap <strong>Share</strong> &rarr;{" "}
            <strong>Add to Home Screen</strong>, then open from there and tap
            this button again.
          </p>
        </div>
      ) : (
        <>
          <button
            onClick={handleSubscribe}
            disabled={isSubscribed || isSubscribing}
            className={`border-none rounded-3xl py-3 px-7 text-[0.95rem] font-semibold cursor-pointer tracking-wide transition-colors text-white ${
              isSubscribed
                ? "bg-green-700 cursor-default"
                : "bg-dominos-blue hover:bg-dominos-blue-dark"
            }`}
          >
            {isSubscribed
              ? "Notifications enabled"
              : isSubscribing
                ? "Subscribing..."
                : "Get notified of updates"}
          </button>
          {!isSubscribed && isSupported && (
            <div className="text-gray-400 text-xs mt-2 leading-snug">
              FYI you will also receive push notifications from the apple notes
              doc
            </div>
          )}
          {isSubscribed && (
            <div className="text-gray-400 text-xs mt-2 leading-snug">
              {getNotificationHint()}
            </div>
          )}
        </>
      )}

      {error && (
        <div className="text-dominos-red text-sm mt-1.5">{error}</div>
      )}
    </div>
  );
}
