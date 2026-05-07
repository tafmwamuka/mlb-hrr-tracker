import { trpc } from "@/lib/trpc";
import { Bell, X } from "lucide-react";
import { useState } from "react";
import { Card } from "@/components/ui/card";

export function NotificationBell() {
  const [showDropdown, setShowDropdown] = useState(false);
  const { data: notifications } = trpc.notifications.getNotifications.useQuery();
  const markAsReadMutation = trpc.notifications.markAsRead.useMutation();
  const clearAllMutation = trpc.notifications.clearAll.useMutation();

  const unreadCount = (notifications as any)?.filter((n: any) => !n.read).length || 0;

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="relative p-2 text-slate-400 hover:text-white transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white transform translate-x-1/2 -translate-y-1/2 bg-red-600 rounded-full">
            {unreadCount}
          </span>
        )}
      </button>

      {showDropdown && (
        <Card className="absolute right-0 mt-2 w-80 bg-slate-800 border-slate-700 p-4 max-h-96 overflow-y-auto z-50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-white">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={() => clearAllMutation.mutate()}
                className="text-xs text-slate-400 hover:text-white"
              >
                Clear All
              </button>
            )}
          </div>

          {!notifications || (notifications as any).length === 0 ? (
            <p className="text-sm text-slate-400">No notifications</p>
          ) : (
            <div className="space-y-2">
              {(notifications as any).map((notif: any) => (
                <div
                  key={notif.id}
                  className={`p-3 rounded-lg text-sm ${
                    notif.read ? "bg-slate-700" : "bg-slate-600 border border-slate-500"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-white">{notif.title}</p>
                      <p className="text-xs text-slate-300 mt-1">{notif.message}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {new Date(notif.createdAt).toLocaleTimeString()}
                      </p>
                    </div>
                    {!notif.read && (
                      <button
                        onClick={() => markAsReadMutation.mutate({ notificationId: notif.id })}
                        className="ml-2 text-slate-400 hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
