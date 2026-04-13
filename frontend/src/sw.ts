/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

interface PushData {
  title?: string;
  body?: string;
  url?: string;
  stage?: number;
  updatedAt?: number;
}

self.addEventListener("push", (event: PushEvent) => {
  if (!event.data) return;

  let data: PushData;
  try {
    data = event.data.json() as PushData;
  } catch {
    data = { title: "Update", body: event.data.text() };
  }

  const title = data.title || "Elody's Tracker";
  const options: NotificationOptions = {
    body: data.body || "",
    icon: "icons/icon-192.svg",
    badge: "icons/icon-192.svg",
    data: { url: self.location.origin + "/" },
  };

  event.waitUntil(
    self.registration
      .showNotification(title, options)
      .then(() =>
        self.clients.matchAll({ type: "window", includeUncontrolled: true }),
      )
      .then((clientList) => {
        for (const client of clientList) {
          client.postMessage({ type: "push-update", data });
        }
      }),
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();

  const origin = self.location.origin;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.startsWith(origin) && "focus" in client) {
            return (client as WindowClient).focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(origin + "/");
        }
      }),
  );
});

export {};
