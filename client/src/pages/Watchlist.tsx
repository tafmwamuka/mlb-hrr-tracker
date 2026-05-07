import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Loader2 } from "lucide-react";
import { useState } from "react";

export default function Watchlist() {
  const [selectedStat, setSelectedStat] = useState<"hits" | "runs" | "rbi" | "slg">("hits");

  const { data: favorites, isLoading } = trpc.favorites.getAllFavorites.useQuery();
  const removeFavoriteMutation = trpc.favorites.removeFavorite.useMutation();

  const filteredFavorites = (favorites as any)?.filter((fav: any) => fav.statType === selectedStat) || [];

  const statConfig = {
    hits: { label: "Hits", color: "text-amber-400", bgColor: "bg-amber-400/10" },
    runs: { label: "Runs", color: "text-orange-400", bgColor: "bg-orange-400/10" },
    rbi: { label: "RBI", color: "text-emerald-400", bgColor: "bg-emerald-400/10" },
    slg: { label: "Slg %", color: "text-purple-400", bgColor: "bg-purple-400/10" },
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin w-8 h-8 text-slate-400" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-3xl font-bold text-white mb-6">My Players</h1>

      {/* Stat Tabs */}
      <div className="flex gap-2 mb-6">
        {(["hits", "runs", "rbi", "slg"] as const).map((stat) => {
          const config = statConfig[stat];
          const isActive = stat === selectedStat;
          return (
            <button
              key={stat}
              onClick={() => setSelectedStat(stat)}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                isActive
                  ? `${config.bgColor} ${config.color}`
                  : "bg-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              {config.label}
            </button>
          );
        })}
      </div>

      {/* Favorites List */}
      <div className="space-y-3">
        {filteredFavorites.length === 0 ? (
          <Card className="bg-slate-800 border-slate-700 p-8 text-center">
            <p className="text-slate-400">No {statConfig[selectedStat].label} favorites yet</p>
          </Card>
        ) : (
          filteredFavorites.map((fav: any) => (
            <Card key={fav.favoriteId} className="bg-slate-800 border-slate-700 p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-lg font-bold text-white">{fav.playerName}</h3>
                    <Badge className={statConfig[fav.statType as keyof typeof statConfig]?.bgColor}>
                      {fav.prediction.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-400 mb-2">
                    Line: {fav.line} • Confidence: {fav.confidence}%
                  </p>
                  <p className="text-sm text-slate-300">{fav.reasoning}</p>
                </div>
                <button
                  onClick={() => removeFavoriteMutation.mutate({ favoriteId: fav.favoriteId })}
                  className="text-slate-400 hover:text-red-400 transition-colors ml-4"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
