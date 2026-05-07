import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Bell, AlertCircle, TrendingUp, Zap, Target, CheckCircle } from "lucide-react";

export interface Notification {
  id: string;
  type: "new-plays" | "favorite-game" | "odds-change" | "daily-update" | "info" | "success" | "error";
  title: string;
  message: string;
  timestamp: number;
  dismissible?: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface NotificationCenterProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

const NOTIFICATION_CONFIG = {
  "new-plays": {
    icon: TrendingUp,
    color: "oklch(0.82 0.17 85)",
    bg: "oklch(0.82 0.17 85 / 0.1)",
    title: "🔥 New Top Plays",
  },
  "favorite-game": {
    icon: Star,
    color: "oklch(0.75 0.20 290)",
    bg: "oklch(0.75 0.20 290 / 0.1)",
    title: "⭐ Favorite Player Game",
  },
  "odds-change": {
    icon: Zap,
    color: "oklch(0.68 0.22 25)",
    bg: "oklch(0.68 0.22 25 / 0.1)",
    title: "⚡ Odds Changed",
  },
  "daily-update": {
    icon: Target,
    color: "oklch(0.72 0.18 165)",
    bg: "oklch(0.72 0.18 165 / 0.1)",
    title: "🎯 Daily Update",
  },
  info: {
    icon: AlertCircle,
    color: "oklch(0.60 0.15 200)",
    bg: "oklch(0.60 0.15 200 / 0.1)",
    title: "ℹ️ Info",
  },
  success: {
    icon: CheckCircle,
    color: "oklch(0.70 0.15 150)",
    bg: "oklch(0.70 0.15 150 / 0.1)",
    title: "✓ Success",
  },
  error: {
    icon: AlertCircle,
    color: "oklch(0.68 0.22 25)",
    bg: "oklch(0.68 0.22 25 / 0.1)",
    title: "✕ Error",
  },
};

function Star({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

export function NotificationCenter({ notifications, onDismiss }: NotificationCenterProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [showPanel, setShowPanel] = useState(false);

  useEffect(() => {
    setUnreadCount(notifications.length);
  }, [notifications]);

  const handleDismiss = useCallback(
    (id: string) => {
      onDismiss(id);
    },
    [onDismiss]
  );

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {/* Notification Bell Button */}
      <motion.button
        onClick={() => setShowPanel(!showPanel)}
        className="relative p-3 rounded-full bg-[oklch(0.18_0.02_255)] border border-[oklch(1_0_0/8%)] hover:bg-[oklch(0.22_0.025_255)] transition-colors"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <Bell size={20} className="text-[oklch(0.70_0.15_150)]" />
        {unreadCount > 0 && (
          <motion.span
            className="absolute top-0 right-0 w-5 h-5 bg-[oklch(0.68_0.22_25)] rounded-full flex items-center justify-center text-xs font-bold text-white"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
          >
            {Math.min(unreadCount, 9)}
          </motion.span>
        )}
      </motion.button>

      {/* Notification Panel */}
      <AnimatePresence>
        {showPanel && (
          <motion.div
            className="absolute bottom-16 right-0 w-96 max-h-96 bg-[oklch(0.14_0.022_255)] border border-[oklch(1_0_0/8%)] rounded-lg overflow-hidden shadow-2xl"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            {/* Header */}
            <div className="p-4 border-b border-[oklch(1_0_0/8%)] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Notifications</h3>
              <button
                onClick={() => setShowPanel(false)}
                className="p-1 hover:bg-[oklch(1_0_0/8%)] rounded transition-colors"
              >
                <X size={16} className="text-[oklch(0.50_0.015_255)]" />
              </button>
            </div>

            {/* Notifications List */}
            <div className="overflow-y-auto max-h-80">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-[oklch(0.50_0.015_255)]">
                  <Bell size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No notifications yet</p>
                </div>
              ) : (
                <div className="divide-y divide-[oklch(1_0_0/8%)]">
                  {notifications.map((notif) => {
                    const config = NOTIFICATION_CONFIG[notif.type];
                    const Icon = config.icon;

                    return (
                      <motion.div
                        key={notif.id}
                        className="p-3 hover:bg-[oklch(1_0_0/4%)] transition-colors"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                      >
                        <div className="flex gap-3">
                          <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: config.bg, color: config.color }}
                          >
                            <Icon size={18} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <h4 className="text-sm font-bold text-white truncate">
                                  {notif.title}
                                </h4>
                                <p className="text-xs text-[oklch(0.50_0.015_255)] mt-0.5 line-clamp-2">
                                  {notif.message}
                                </p>
                              </div>
                              {notif.dismissible !== false && (
                                <button
                                  onClick={() => handleDismiss(notif.id)}
                                  className="p-1 hover:bg-[oklch(1_0_0/8%)] rounded transition-colors shrink-0"
                                >
                                  <X size={14} className="text-[oklch(0.40_0.015_255)]" />
                                </button>
                              )}
                            </div>

                            {notif.action && (
                              <button
                                onClick={() => {
                                  notif.action?.onClick();
                                  handleDismiss(notif.id);
                                }}
                                className="mt-2 text-xs font-semibold px-2 py-1 rounded bg-[oklch(1_0_0/8%)] hover:bg-[oklch(1_0_0/12%)] transition-colors"
                                style={{ color: config.color }}
                              >
                                {notif.action.label}
                              </button>
                            )}

                            <div className="text-[10px] text-[oklch(0.35_0.015_255)] mt-1">
                              {new Date(notif.timestamp).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast Notifications (appear at bottom) */}
      <div className="fixed bottom-24 right-6 space-y-2 pointer-events-none">
        <AnimatePresence>
          {notifications.slice(0, 3).map((notif) => {
            const config = NOTIFICATION_CONFIG[notif.type];
            const Icon = config.icon;

            return (
              <motion.div
                key={`toast-${notif.id}`}
                className="pointer-events-auto p-3 rounded-lg bg-[oklch(0.14_0.022_255)] border flex items-center gap-3"
                style={{ borderColor: config.color }}
                initial={{ opacity: 0, y: 20, x: 100 }}
                animate={{ opacity: 1, y: 0, x: 0 }}
                exit={{ opacity: 0, y: 20, x: 100 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              >
                <div style={{ color: config.color }}>
                  <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{notif.title}</p>
                  <p className="text-xs text-[oklch(0.50_0.015_255)] truncate">{notif.message}</p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
