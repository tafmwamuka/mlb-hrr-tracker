import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save } from "lucide-react";
import { useState } from "react";

export default function Settings() {
  const { data: settings, isLoading } = trpc.settings.getSettings.useQuery();
  const updateSettingsMutation = trpc.settings.updateSettings.useMutation();

  const [formData, setFormData] = useState<{
    minConfidence: number;
    enableNotifications: boolean;
    notificationThreshold: number;
    preferredStats: ("hits" | "runs" | "rbi" | "slg")[];
  }>({
    minConfidence: settings?.minConfidence || 75,
    enableNotifications: settings?.enableNotifications ?? true,
    notificationThreshold: settings?.notificationThreshold || 80,
    preferredStats: (settings?.preferredStats as any) || ["hits", "runs", "rbi", "slg"],
  });

  const handleSave = () => {
    updateSettingsMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin w-8 h-8 text-slate-400" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-3xl font-bold text-white mb-6">Settings</h1>

      <div className="space-y-6">
        {/* Prop Model Preferences */}
        <Card className="bg-slate-800 border-slate-700 p-6">
          <h2 className="text-xl font-bold text-white mb-4">Prop Model Preferences</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Minimum Confidence Threshold
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={formData.minConfidence}
                onChange={(e) =>
                  setFormData({ ...formData, minConfidence: parseInt(e.target.value) })
                }
                className="w-full"
              />
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>0%</span>
                <span className="font-bold text-white">{formData.minConfidence}%</span>
                <span>100%</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Preferred Stats
              </label>
              <div className="flex flex-wrap gap-2">
                {(["hits", "runs", "rbi", "slg"] as const).map((stat) => (
                  <button
                    key={stat}
                    onClick={() => {
                      const newStats = formData.preferredStats.includes(stat as any)
                        ? formData.preferredStats.filter((s) => s !== stat)
                        : [...formData.preferredStats, stat as any];
                      setFormData({ ...formData, preferredStats: newStats as any });
                    }}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition-all ${
                      formData.preferredStats.includes(stat)
                        ? "bg-blue-600 text-white"
                        : "bg-slate-700 text-slate-400 hover:text-white"
                    }`}
                  >
                    {stat.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Notifications */}
        <Card className="bg-slate-800 border-slate-700 p-6">
          <h2 className="text-xl font-bold text-white mb-4">Notifications</h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-300">Enable Notifications</label>
              <button
                onClick={() =>
                  setFormData({
                    ...formData,
                    enableNotifications: !formData.enableNotifications,
                  })
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  formData.enableNotifications ? "bg-blue-600" : "bg-slate-600"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    formData.enableNotifications ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {formData.enableNotifications && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Notification Threshold
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={formData.notificationThreshold}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      notificationThreshold: parseInt(e.target.value),
                    })
                  }
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-slate-400 mt-1">
                  <span>0%</span>
                  <span className="font-bold text-white">{formData.notificationThreshold}%</span>
                  <span>100%</span>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Save Button */}
        <Button
          onClick={handleSave}
          disabled={updateSettingsMutation.isPending}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white"
        >
          {updateSettingsMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
