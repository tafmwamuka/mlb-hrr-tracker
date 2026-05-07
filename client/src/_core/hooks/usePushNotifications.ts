import { useEffect, useState, useCallback } from "react";

export interface PushNotificationOptions {
  title: string;
  message: string;
  type: "new-plays" | "favorite-game" | "odds-change" | "daily-update";
  action?: {
    label: string;
    url: string;
  };
}

export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  // Initialize service worker
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      console.log("Push notifications not supported");
      setIsSupported(false);
      return;
    }

    setIsSupported(true);

    navigator.serviceWorker
      .register("/service-worker.js")
      .then((reg) => {
        console.log("Service Worker registered");
        setRegistration(reg);

        // Check if already subscribed
        reg.pushManager.getSubscription().then((subscription) => {
          setIsSubscribed(!!subscription);
        });
      })
      .catch((error) => {
        console.error("Service Worker registration failed:", error);
      });
  }, []);

  // Request notification permission
  const requestPermission = useCallback(async () => {
    if (!("Notification" in window)) {
      console.log("Notifications not supported");
      return false;
    }

    if (Notification.permission === "granted") {
      return true;
    }

    if (Notification.permission !== "denied") {
      const permission = await Notification.requestPermission();
      return permission === "granted";
    }

    return false;
  }, []);

  // Subscribe to push notifications
  const subscribe = useCallback(async () => {
    if (!registration || !isSupported) return false;

    try {
      const permission = await requestPermission();
      if (!permission) {
        console.log("Notification permission denied");
        return false;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // Note: In production, you would use a real VAPID public key
        // For now, we'll use a placeholder
      });

      console.log("Push subscription successful:", subscription);
      setIsSubscribed(true);
      return true;
    } catch (error) {
      console.error("Failed to subscribe to push notifications:", error);
      return false;
    }
  }, [registration, isSupported, requestPermission]);

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async () => {
    if (!registration) return false;

    try {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        setIsSubscribed(false);
        console.log("Unsubscribed from push notifications");
        return true;
      }
    } catch (error) {
      console.error("Failed to unsubscribe:", error);
    }
    return false;
  }, [registration]);

  // Send local notification (for testing)
  const sendLocalNotification = useCallback(
    async (options: PushNotificationOptions) => {
      if (!registration || !isSupported) return;

      try {
        await registration.showNotification(options.title, {
          body: options.message,
          icon: "/favicon.ico",
          badge: "/favicon.ico",
          tag: options.type,
          requireInteraction: options.type === "odds-change" || options.type === "favorite-game",
          data: {
            type: options.type,
            action: options.action,
          },
        });
      } catch (error) {
        console.error("Failed to send notification:", error);
      }
    },
    [registration, isSupported]
  );

  return {
    isSupported,
    isSubscribed,
    requestPermission,
    subscribe,
    unsubscribe,
    sendLocalNotification,
  };
}
