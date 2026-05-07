// Service Worker for push notifications
self.addEventListener("install", (event) => {
  console.log("Service Worker installed");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("Service Worker activated");
  event.waitUntil(clients.claim());
});

// Handle push notifications
self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.message,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag: data.type,
      requireInteraction: data.type === "odds-change" || data.type === "favorite-game",
      data: {
        type: data.type,
        action: data.action,
      },
    };

    event.waitUntil(self.registration.showNotification(data.title, options));
  } catch (error) {
    console.error("Error handling push notification:", error);
  }
});

// Handle notification clicks
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      // Focus existing window if available
      for (let i = 0; i < clientList.length; i++) {
        if (clientList[i].url === "/" && "focus" in clientList[i]) {
          return clientList[i].focus();
        }
      }
      // Open new window if none exists
      if (clients.openWindow) {
        return clients.openWindow("/");
      }
    })
  );
});

// Handle notification close
self.addEventListener("notificationclose", (event) => {
  console.log("Notification closed:", event.notification.tag);
});
