import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Zap, Target, Activity, Loader2, Star } from "lucide-react";
import { useLocation } from "wouter";

export default function Props() {
  const [activeTab, setActiveTab] = useState<"all" | "high-confidence">("all");
  const [, navigate] = useLocation();

  const { data: allProps, isLoading: allLoading } = trpc.props.getTodayProps.useQuery();
  const { data: highConfidence, isLoading: hcLoading } = trpc.props.getHighConfidenceProps.useQuery();
  const { data: performance } = trpc.props.getModelPerformance.useQuery();
  const addFavoriteMutation = trpc.favorites.addFavorite.useMutation();
  const isFavoritedQuery = trpc.favorites.isFavorited.useQuery({ gameId: "", playerId: 0, statType: "hits" }, { enabled: false });

  const displayProps = activeTab === "high-confidence" ? highConfidence : allProps;
  const isLoading = activeTab === "high-confidence" ? hcLoading : allLoading;

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return "bg-green-500/20 text-green-700";
    if (confidence >= 70) return "bg-blue-500/20 text-blue-700";
    if (confidence >= 60) return "bg-yellow-500/20 text-yellow-700";
    return "bg-gray-500/20 text-gray-700";
  };

  const getStatIcon = (stat: "hits" | "runs" | "rbi" | "slg") => {
    switch (stat) {
      case "hits":
        return <TrendingUp className="w-4 h-4" />;
      case "runs":
        return <Zap className="w-4 h-4" />;
      case "rbi":
        return <Target className="w-4 h-4" />;
      case "slg":
        return <Activity className="w-4 h-4" />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">MLB Prop Predictions</h1>
            <p className="text-slate-400">AI-powered H/R/RBI/Slg % prop lines with park adjustments</p>
          </div>
          <button
            onClick={() => navigate("/favorites")}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
          >
            <Star className="w-5 h-5 fill-current" />
            My Plays
          </button>
        </div>

        {/* Performance Stats */}
        {performance && (
          <Card className="mb-6 bg-slate-800 border-slate-700 p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-slate-400">Overall Hit Rate</p>
                <p className="text-2xl font-bold text-white">{performance.overallHitRate}%</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Hits Accuracy</p>
                <p className="text-2xl font-bold text-amber-400">{performance.hitsHitRate}%</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Runs Accuracy</p>
                <p className="text-2xl font-bold text-orange-400">{performance.runsHitRate}%</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">RBI Accuracy</p>
                <p className="text-2xl font-bold text-emerald-400">{performance.rbiHitRate}%</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Slg % Accuracy</p>
                <p className="text-2xl font-bold text-purple-400">{performance.slgHitRate || "N/A"}%</p>
              </div>
            </div>
          </Card>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "all" | "high-confidence")} className="mb-6">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="all">All Predictions</TabsTrigger>
            <TabsTrigger value="high-confidence">High Confidence (75%+)</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-4 mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : displayProps && displayProps.length > 0 ? (
              displayProps.map((pred) => (
                <Card key={pred.id} className="bg-slate-800 border-slate-700 p-4">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-white">{pred.playerName}</h3>
                      <p className="text-sm text-slate-400">Game: {new Date(pred.gameDate).toLocaleDateString()}</p>
                    </div>
                  </div>

                  {/* Props Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Hits */}
                    {pred.hitsPrediction && (
                      <div className="bg-slate-700/50 rounded-lg p-3 relative">
                        <button
                          onClick={() => addFavoriteMutation.mutate({
                            gameId: pred.gameId,
                            playerId: pred.playerId,
                            playerName: pred.playerName,
                            playerTeam: "",
                            statType: "hits",
                            prediction: pred.hitsPrediction.prediction,
                            line: pred.hitsPrediction.line,
                            confidence: pred.hitsPrediction.confidence,
                            reasoning: pred.hitsReasoning || "",
                            gameDate: new Date(pred.gameDate),
                          })}
                          className="absolute top-2 right-2 text-amber-400 hover:text-amber-300 transition-colors"
                        >
                          <Star className="w-4 h-4 fill-current" />
                        </button>
                        <div className="flex items-center gap-2 mb-2">
                          {getStatIcon("hits")}
                          <span className="text-sm font-semibold text-amber-400">Hits</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-300">Line: {pred.hitsPrediction.line}</span>
                            <Badge className={getConfidenceColor(pred.hitsPrediction.confidence)}>
                              {pred.hitsPrediction.confidence}%
                            </Badge>
                          </div>
                          <div className="text-sm font-bold text-white">
                            {pred.hitsPrediction.prediction.toUpperCase()}
                          </div>
                          <p className="text-xs text-slate-400 mt-1">{pred.hitsReasoning}</p>
                        </div>
                      </div>
                    )}

                    {/* Runs */}
                    {pred.runsPrediction && (
                      <div className="bg-slate-700/50 rounded-lg p-3 relative">
                        <button
                          onClick={() => addFavoriteMutation.mutate({
                            gameId: pred.gameId,
                            playerId: pred.playerId,
                            playerName: pred.playerName,
                            playerTeam: "",
                            statType: "runs",
                            prediction: pred.runsPrediction.prediction,
                            line: pred.runsPrediction.line,
                            confidence: pred.runsPrediction.confidence,
                            reasoning: pred.runsReasoning || "",
                            gameDate: new Date(pred.gameDate),
                          })}
                          className="absolute top-2 right-2 text-orange-400 hover:text-orange-300 transition-colors"
                        >
                          <Star className="w-4 h-4 fill-current" />
                        </button>
                        <div className="flex items-center gap-2 mb-2">
                          {getStatIcon("runs")}
                          <span className="text-sm font-semibold text-orange-400">Runs</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-300">Line: {pred.runsPrediction.line}</span>
                            <Badge className={getConfidenceColor(pred.runsPrediction.confidence)}>
                              {pred.runsPrediction.confidence}%
                            </Badge>
                          </div>
                          <div className="text-sm font-bold text-white">
                            {pred.runsPrediction.prediction.toUpperCase()}
                          </div>
                          <p className="text-xs text-slate-400 mt-1">{pred.runsReasoning}</p>
                        </div>
                      </div>
                    )}

                    {/* RBI */}
                    {pred.rbiPrediction && (
                      <div className="bg-slate-700/50 rounded-lg p-3 relative">
                        <button
                          onClick={() => addFavoriteMutation.mutate({
                            gameId: pred.gameId,
                            playerId: pred.playerId,
                            playerName: pred.playerName,
                            playerTeam: "",
                            statType: "rbi",
                            prediction: pred.rbiPrediction.prediction,
                            line: pred.rbiPrediction.line,
                            confidence: pred.rbiPrediction.confidence,
                            reasoning: pred.rbiReasoning || "",
                            gameDate: new Date(pred.gameDate),
                          })}
                          className="absolute top-2 right-2 text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                          <Star className="w-4 h-4 fill-current" />
                        </button>
                        <div className="flex items-center gap-2 mb-2">
                          {getStatIcon("rbi")}
                          <span className="text-sm font-semibold text-emerald-400">RBI</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-300">Line: {pred.rbiPrediction.line}</span>
                            <Badge className={getConfidenceColor(pred.rbiPrediction.confidence)}>
                              {pred.rbiPrediction.confidence}%
                            </Badge>
                          </div>
                          <div className="text-sm font-bold text-white">
                            {pred.rbiPrediction.prediction.toUpperCase()}
                          </div>
                          <p className="text-xs text-slate-400 mt-1">{pred.rbiReasoning}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              ))
            ) : (
              <div className="text-center py-8 text-slate-400">
                No prop predictions available for today
              </div>
            )}
          </TabsContent>

          <TabsContent value="high-confidence" className="space-y-4 mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : displayProps && displayProps.length > 0 ? (
              displayProps.map((pred) => (
                <Card key={pred.id} className="bg-slate-800 border-slate-700 p-4">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-white">{pred.playerName}</h3>
                      <p className="text-sm text-slate-400">Game: {new Date(pred.gameDate).toLocaleDateString()}</p>
                    </div>
                  </div>

                  {/* Props Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Hits */}
                    {pred.hitsPrediction && (
                      <div className="bg-slate-700/50 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          {getStatIcon("hits")}
                          <span className="text-sm font-semibold text-amber-400">Hits</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-300">Line: {pred.hitsPrediction.line}</span>
                            <Badge className={getConfidenceColor(pred.hitsPrediction.confidence)}>
                              {pred.hitsPrediction.confidence}%
                            </Badge>
                          </div>
                          <div className="text-sm font-bold text-white">
                            {pred.hitsPrediction.prediction.toUpperCase()}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Runs */}
                    {pred.runsPrediction && (
                      <div className="bg-slate-700/50 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          {getStatIcon("runs")}
                          <span className="text-sm font-semibold text-orange-400">Runs</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-300">Line: {pred.runsPrediction.line}</span>
                            <Badge className={getConfidenceColor(pred.runsPrediction.confidence)}>
                              {pred.runsPrediction.confidence}%
                            </Badge>
                          </div>
                          <div className="text-sm font-bold text-white">
                            {pred.runsPrediction.prediction.toUpperCase()}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* RBI */}
                    {pred.rbiPrediction && (
                      <div className="bg-slate-700/50 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          {getStatIcon("rbi")}
                          <span className="text-sm font-semibold text-emerald-400">RBI</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-300">Line: {pred.rbiPrediction.line}</span>
                            <Badge className={getConfidenceColor(pred.rbiPrediction.confidence)}>
                              {pred.rbiPrediction.confidence}%
                            </Badge>
                          </div>
                          <div className="text-sm font-bold text-white">
                            {pred.rbiPrediction.prediction.toUpperCase()}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              ))
            ) : (
              <div className="text-center py-8 text-slate-400">
                No high-confidence predictions available
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
