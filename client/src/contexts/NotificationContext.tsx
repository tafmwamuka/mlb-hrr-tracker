import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { Notification } from "@/components/NotificationCenter";

interface NotificationContextType {
  notifications: Notification[];
  addNotification: (notif: Omit<Notification, "id" | "timestamp">) => string;
  removeNotification: (id: string) => void;
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotification = useCallback(
    (notif: Omit<Notification, "id" | "timestamp">) => {
      const id = `notif-${Date.now()}-${Math.random()}`;
      const newNotif: Notification = {
        ...notif,
        id,
        timestamp: Date.now(),
      };

      setNotifications((prev) => [newNotif, ...prev]);

      // Auto-dismiss after 5 seconds if dismissible
      if (notif.dismissible !== false) {
        setTimeout(() => {
          removeNotification(id);
        }, 5000);
      }

      return id;
    },
    []
  );

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        addNotification,
        removeNotification,
        clearAll,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationProvider");
  }
  return context;
}
