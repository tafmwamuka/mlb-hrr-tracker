import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Zap, Target, Activity, Loader2, Star, Brain, Zap as Lightning, BarChart3, Lightbulb } from "lucide-react";
import { useLocation } from "wouter";

export default function Props() {
  const [activeTab, setActiveTab] = useState<"all" | "high-confidence">("all");
  const [, navigate] = useLocation();

  const { data: allProps, isLoading: allLoading } = trpc.props.getTodayProps.useQuery();
  const { data: highConfidence, isLoading: hcLoading } = trpc.props.getHighConfidenceProps.useQuery();
  const { data: performance } = trpc.props.getModelPerformance.useQuery();
  const addFavoriteMutation = trpc.favorites.addFavorite.useMutation();

  const displayProps = activeTab === "high-confidence" ? highConfidence : allProps;
  const isLoading = activeTab === "high-confidence" ? hcLoading : allLoading;

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 85) return "bg-emerald-500/30 text-emerald-300 border border-emerald-500/50";
    if (confidence >= 75) return "bg-blue-500/30 text-blue-300 border border-blue-500/50";
    if (confidence >= 65) return "bg-amber-500/30 text-amber-300 border border-amber-500/50";
    return "bg-slate-500/30 text-slate-300 border border-slate-500/50";
  };

  const getStatIcon = (stat: "hits" | "runs" | "rbi") => {
    switch (stat) {
      case "hits":
        return <TrendingUp className="w-5 h-5" />;
      case "runs":
        return <Lightning className="w-5 h-5" />;
      case "rbi":
        return <Target className="w-5 h-5" />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header Section */}
        <div className="mb-12">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg">
                  <Brain className="w-6 h-6 text-white" />
                </div>
                <h1 className="text-5xl font-bold text-white">AI Prop Predictions</h1>
              </div>
              <p className="text-slate-400 text-lg ml-11">Advanced machine learning analysis of today's best betting opportunities</p>
            </div>
            <button
              onClick={() => navigate("/favorites")}
              className="flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 transition-all font-semibold shadow-lg hover:shadow-xl"
            >
              <Star className="w-5 h-5 fill-current" />
              My Plays
            </button>
          </div>

          {/* Methodology Section */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="bg-slate-800/50 border-slate-700 p-4 backdrop-blur">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <BarChart3 className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Data Sources</p>
                  <p className="text-sm text-slate-200 mt-1">MLB Stats, Ballpark, HR Targets, Odds API</p>
                </div>
              </div>
            </Card>
            <Card className="bg-slate-800/50 border-slate-700 p-4 backdrop-blur">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-purple-500/20 rounded-lg">
                  <Lightbulb className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Analysis</p>
                  <p className="text-sm text-slate-200 mt-1">Handedness, Form, Weather, Park</p>
                </div>
              </div>
            </Card>
            <Card className="bg-slate-800/50 border-slate-700 p-4 backdrop-blur">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-emerald-500/20 rounded-lg">
                  <Brain className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Model</p>
                  <p className="text-sm text-slate-200 mt-1">Weighted confidence scoring</p>
                </div>
              </div>
            </Card>
            <Card className="bg-slate-800/50 border-slate-700 p-4 backdrop-blur">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-amber-500/20 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Output</p>
                  <p className="text-sm text-slate-200 mt-1">OVER props with confidence %</p>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Performance Stats */}
        {performance && (
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-blue-400" />
              Model Performance
            </h2>
            <Card className="bg-gradient-to-r from-slate-800/80 to-slate-700/80 border-slate-600 p-8 backdrop-blur">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
                <div className="text-center">
                  <p className="text-xs text-slate-400 uppercase tracking-widest font-bold mb-2">Overall Hit Rate</p>
                  <p className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent">{performance.overallHitRate}%</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-400 uppercase tracking-widest font-bold mb-2">Hits</p>
                  <p className="text-4xl font-bold text-amber-400">{performance.hitsHitRate}%</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-400 uppercase tracking-widest font-bold mb-2">Runs</p>
                  <p className="text-4xl font-bold text-orange-400">{performance.runsHitRate}%</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-400 uppercase tracking-widest font-bold mb-2">RBI</p>
                  <p className="text-4xl font-bold text-emerald-400">{performance.rbiHitRate}%</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-400 uppercase tracking-widest font-bold mb-2">Slg %</p>
                  <p className="text-4xl font-bold text-purple-400">{performance.slgHitRate || "N/A"}%</p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Predictions Section */}
        <div>
          <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
            <Lightning className="w-6 h-6 text-orange-400" />
            Today's Predictions
          </h2>
          
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "all" | "high-confidence")} className="">
            <TabsList className="bg-slate-800/50 border border-slate-700 mb-8 backdrop-blur">
              <TabsTrigger value="all" className="data-[state=active]:bg-slate-700">All Predictions</TabsTrigger>
              <TabsTrigger value="high-confidence" className="data-[state=active]:bg-slate-700">High Confidence (75%+)</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="space-y-6 mt-6">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
                </div>
              ) : displayProps && displayProps.length > 0 ? (
                displayProps.map((pred) => (
                  <Card key={pred.id} className="bg-gradient-to-br from-slate-800 to-slate-700/50 border-slate-600 overflow-hidden hover:border-slate-500 transition-all hover:shadow-lg">
                    <div className="p-6">
                      {/* Player Header */}
                      <div className="flex items-center justify-between mb-6 pb-6 border-b border-slate-600">
                        <div>
                          <h3 className="text-2xl font-bold text-white mb-1">{pred.playerName}</h3>
                          <p className="text-sm text-slate-400">Game: {new Date(pred.gameDate).toLocaleDateString()}</p>
                        </div>
                      </div>

                      {/* Props Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* Hits */}
                        {pred.hitsPrediction && (
                          <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600 hover:border-amber-500/50 transition-colors">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className="p-2 bg-amber-500/20 rounded-lg">
                                  {getStatIcon("hits")}
                                </div>
                                <span className="font-semibold text-amber-400">Hits</span>
                              </div>
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
                                className="text-amber-400 hover:text-amber-300 transition-colors"
                              >
                                <Star className="w-5 h-5 fill-current" />
                              </button>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-300">Line</span>
                                <span className="font-bold text-white">{pred.hitsPrediction.line}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-300">Prediction</span>
                                <span className="font-bold text-amber-300">{pred.hitsPrediction.prediction.toUpperCase()}</span>
                              </div>
                              <Badge className={`w-full justify-center py-1 ${getConfidenceColor(pred.hitsPrediction.confidence)}`}>
                                {pred.hitsPrediction.confidence}% Confidence
                              </Badge>
                              <p className="text-xs text-slate-400 mt-2">{pred.hitsReasoning}</p>
                            </div>
                          </div>
                        )}

                        {/* Runs */}
                        {pred.runsPrediction && (
                          <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600 hover:border-orange-500/50 transition-colors">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className="p-2 bg-orange-500/20 rounded-lg">
                                  {getStatIcon("runs")}
                                </div>
                                <span className="font-semibold text-orange-400">Runs</span>
                              </div>
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
                                className="text-orange-400 hover:text-orange-300 transition-colors"
                              >
                                <Star className="w-5 h-5 fill-current" />
                              </button>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-300">Line</span>
                                <span className="font-bold text-white">{pred.runsPrediction.line}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-300">Prediction</span>
                                <span className="font-bold text-orange-300">{pred.runsPrediction.prediction.toUpperCase()}</span>
                              </div>
                              <Badge className={`w-full justify-center py-1 ${getConfidenceColor(pred.runsPrediction.confidence)}`}>
                                {pred.runsPrediction.confidence}% Confidence
                              </Badge>
                              <p className="text-xs text-slate-400 mt-2">{pred.runsReasoning}</p>
                            </div>
                          </div>
                        )}

                        {/* RBI */}
                        {pred.rbiPrediction && (
                          <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600 hover:border-emerald-500/50 transition-colors">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className="p-2 bg-emerald-500/20 rounded-lg">
                                  {getStatIcon("rbi")}
                                </div>
                                <span className="font-semibold text-emerald-400">RBI</span>
                              </div>
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
                                className="text-emerald-400 hover:text-emerald-300 transition-colors"
                              >
                                <Star className="w-5 h-5 fill-current" />
                              </button>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-300">Line</span>
                                <span className="font-bold text-white">{pred.rbiPrediction.line}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-300">Prediction</span>
                                <span className="font-bold text-emerald-300">{pred.rbiPrediction.prediction.toUpperCase()}</span>
                              </div>
                              <Badge className={`w-full justify-center py-1 ${getConfidenceColor(pred.rbiPrediction.confidence)}`}>
                                {pred.rbiPrediction.confidence}% Confidence
                              </Badge>
                              <p className="text-xs text-slate-400 mt-2">{pred.rbiReasoning}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                ))
              ) : (
                <Card className="bg-slate-800 border-slate-700 p-8 text-center">
                  <p className="text-slate-400">No predictions available for today</p>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="high-confidence" className="space-y-6 mt-6">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
                </div>
              ) : displayProps && displayProps.length > 0 ? (
                displayProps.map((pred) => (
                  <Card key={pred.id} className="bg-gradient-to-br from-slate-800 to-slate-700/50 border-slate-600 overflow-hidden hover:border-slate-500 transition-all hover:shadow-lg">
                    <div className="p-6">
                      {/* Player Header */}
                      <div className="flex items-center justify-between mb-6 pb-6 border-b border-slate-600">
                        <div>
                          <h3 className="text-2xl font-bold text-white mb-1">{pred.playerName}</h3>
                          <p className="text-sm text-slate-400">Game: {new Date(pred.gameDate).toLocaleDateString()}</p>
                        </div>
                      </div>

                      {/* Props Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* Hits */}
                        {pred.hitsPrediction && pred.hitsPrediction.confidence >= 75 && (
                          <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600 hover:border-amber-500/50 transition-colors">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className="p-2 bg-amber-500/20 rounded-lg">
                                  {getStatIcon("hits")}
                                </div>
                                <span className="font-semibold text-amber-400">Hits</span>
                              </div>
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
                                className="text-amber-400 hover:text-amber-300 transition-colors"
                              >
                                <Star className="w-5 h-5 fill-current" />
                              </button>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-300">Line</span>
                                <span className="font-bold text-white">{pred.hitsPrediction.line}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-300">Prediction</span>
                                <span className="font-bold text-amber-300">{pred.hitsPrediction.prediction.toUpperCase()}</span>
                              </div>
                              <Badge className={`w-full justify-center py-1 ${getConfidenceColor(pred.hitsPrediction.confidence)}`}>
                                {pred.hitsPrediction.confidence}% Confidence
                              </Badge>
                              <p className="text-xs text-slate-400 mt-2">{pred.hitsReasoning}</p>
                            </div>
                          </div>
                        )}

                        {/* Runs */}
                        {pred.runsPrediction && pred.runsPrediction.confidence >= 75 && (
                          <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600 hover:border-orange-500/50 transition-colors">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className="p-2 bg-orange-500/20 rounded-lg">
                                  {getStatIcon("runs")}
                                </div>
                                <span className="font-semibold text-orange-400">Runs</span>
                              </div>
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
                                className="text-orange-400 hover:text-orange-300 transition-colors"
                              >
                                <Star className="w-5 h-5 fill-current" />
                              </button>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-300">Line</span>
                                <span className="font-bold text-white">{pred.runsPrediction.line}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-300">Prediction</span>
                                <span className="font-bold text-orange-300">{pred.runsPrediction.prediction.toUpperCase()}</span>
                              </div>
                              <Badge className={`w-full justify-center py-1 ${getConfidenceColor(pred.runsPrediction.confidence)}`}>
                                {pred.runsPrediction.confidence}% Confidence
                              </Badge>
                              <p className="text-xs text-slate-400 mt-2">{pred.runsReasoning}</p>
                            </div>
                          </div>
                        )}

                        {/* RBI */}
                        {pred.rbiPrediction && pred.rbiPrediction.confidence >= 75 && (
                          <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600 hover:border-emerald-500/50 transition-colors">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className="p-2 bg-emerald-500/20 rounded-lg">
                                  {getStatIcon("rbi")}
                                </div>
                                <span className="font-semibold text-emerald-400">RBI</span>
                              </div>
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
                                className="text-emerald-400 hover:text-emerald-300 transition-colors"
                              >
                                <Star className="w-5 h-5 fill-current" />
                              </button>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-300">Line</span>
                                <span className="font-bold text-white">{pred.rbiPrediction.line}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-300">Prediction</span>
                                <span className="font-bold text-emerald-300">{pred.rbiPrediction.prediction.toUpperCase()}</span>
                              </div>
                              <Badge className={`w-full justify-center py-1 ${getConfidenceColor(pred.rbiPrediction.confidence)}`}>
                                {pred.rbiPrediction.confidence}% Confidence
                              </Badge>
                              <p className="text-xs text-slate-400 mt-2">{pred.rbiReasoning}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                ))
              ) : (
                <Card className="bg-slate-800 border-slate-700 p-8 text-center">
                  <p className="text-slate-400">No high-confidence predictions available</p>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
