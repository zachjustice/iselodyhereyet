// Service worker for Web Push Notifications
// Handles push events and notification clicks

self.addEventListener("push", function (event) {
  if (!event.data) return;

  var data;
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: "Update", body: event.data.text() };
  }

  var title = data.title || "Elody's Tracker";
  var options = {
    body: data.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    data: { url: self.location.origin + "/" },
  };

  event.waitUntil(
    self.registration.showNotification(title, options).then(function () {
      return self.clients.matchAll({ type: "window", includeUncontrolled: true });
    }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        clientList[i].postMessage({ type: "push-update", data: data });
      }
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  var origin = self.location.origin;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      // Focus an existing tab if one is open
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.indexOf(origin) === 0 && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open a new tab
      if (clients.openWindow) {
        return clients.openWindow(origin + "/");
      }
    })
  );
});
