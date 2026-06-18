/**
 * Pitchers Tab — Diamond Discipline Database
 *
 * Sections:
 *   1. Today's Pitcher Matchups — starting pitchers with TMS scores
 *   2. Team Discipline Grades — all 30 teams ranked A+ to D
 *   3. Prop Tendency Leaderboards — Walk, K, Patient, Aggressive, Dual-Edge
 *   4. Discipline Edge History — recent picks that fired the edge badge
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FlaskConical,
  TrendingUp,
  Target,
  Zap,
  Shield,
  Activity,
  ChevronDown,
  ChevronUp,
  Trophy,
  History,
  AlertCircle,
} from "lucide-react";

// ── Grade color helpers ────────────────────────────────────────────────────────
function gradeColor(grade: string): string {
  switch (grade) {
    case "A+": return "text-emerald-400 bg-emerald-400/10 border-emerald-400/30";
    case "A":  return "text-green-400 bg-green-400/10 border-green-400/30";
    case "B":  return "text-blue-400 bg-blue-400/10 border-blue-400/30";
    case "C":  return "text-yellow-400 bg-yellow-400/10 border-yellow-400/30";
    case "D":  return "text-red-400 bg-red-400/10 border-red-400/30";
    default:   return "text-gray-400 bg-gray-400/10 border-gray-400/30";
  }
}

function tmsColor(tms: number): string {
  if (tms >= 80) return "text-emerald-400";
  if (tms >= 65) return "text-blue-400";
  if (tms >= 50) return "text-yellow-400";
  return "text-red-400";
}

function tmsLabel(tms: number): string {
  if (tms >= 80) return "Elite Edge";
  if (tms >= 65) return "Strong";
  if (tms >= 50) return "Moderate";
  return "Weak";
}

function tmsBarColor(tms: number): string {
  if (tms >= 80) return "bg-emerald-400";
  if (tms >= 65) return "bg-blue-400";
  if (tms >= 50) return "bg-yellow-400";
  return "bg-red-400";
}

// ── TMS Gauge ─────────────────────────────────────────────────────────────────
function TMSGauge({ tms }: { tms: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`text-2xl font-bold font-mono ${tmsColor(tms)}`}>{tms}</div>
      <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${tmsBarColor(tms)}`}
          style={{ width: `${tms}%` }}
        />
      </div>
      <div className={`text-[10px] font-semibold ${tmsColor(tms)}`}>{tmsLabel(tms)}</div>
    </div>
  );
}

// ── Grade Badge ───────────────────────────────────────────────────────────────
function GradeBadge({ grade }: { grade: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-bold ${gradeColor(grade)}`}>
      {grade}
    </span>
  );
}

// ── Pitcher Matchup Card ───────────────────────────────────────────────────────
function PitcherMatchupCard({ matchup }: { matchup: any }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/4 p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-white/50 text-xs">{matchup.awayTeam}</span>
          <span className="text-white/30 text-xs">@</span>
          <span className="text-white font-semibold text-sm">{matchup.homeTeam}</span>
        </div>
        <span className="text-white/40 text-xs">{matchup.gameTime}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {/* Away pitcher */}
        <div className="rounded-lg bg-white/4 p-2.5">
          <div className="text-[10px] text-white/40 mb-1">{matchup.awayTeam} SP</div>
          {matchup.awayPitcher ? (
            <>
              <div className="text-white text-xs font-semibold leading-tight mb-2">
                {matchup.awayPitcher.name}
              </div>
              <div className="text-[10px] text-white/50 mb-1">vs {matchup.homeTeam}</div>
              {matchup.awayPitcher.tms && (
                <TMSGauge tms={matchup.awayPitcher.tms.tms} />
              )}
            </>
          ) : (
            <div className="text-white/30 text-xs">TBD</div>
          )}
        </div>

        {/* Home pitcher */}
        <div className="rounded-lg bg-white/4 p-2.5">
          <div className="text-[10px] text-white/40 mb-1">{matchup.homeTeam} SP</div>
          {matchup.homePitcher ? (
            <>
              <div className="text-white text-xs font-semibold leading-tight mb-2">
                {matchup.homePitcher.name}
              </div>
              <div className="text-[10px] text-white/50 mb-1">vs {matchup.awayTeam}</div>
              {matchup.homePitcher.tms && (
                <TMSGauge tms={matchup.homePitcher.tms.tms} />
              )}
            </>
          ) : (
            <div className="text-white/30 text-xs">TBD</div>
          )}
        </div>
      </div>

      {/* Discipline edge alerts */}
      {(matchup.awayPitcher?.tms?.hasDisciplineEdge || matchup.homePitcher?.tms?.hasDisciplineEdge) && (
        <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
          <span className="text-purple-400 text-xs">💎</span>
          <span className="text-purple-300 text-xs font-semibold">Discipline Edge Detected</span>
        </div>
      )}
    </div>
  );
}

// ── Team Grade Row ────────────────────────────────────────────────────────────
function TeamGradeRow({ team, rank }: { team: any; rank: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-white/6 last:border-0">
      <button
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left active:bg-white/4 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-white/30 text-xs w-5 text-right shrink-0">{rank}</span>
        <span className="text-white/70 text-xs font-mono w-8 shrink-0">{team.teamAbbr}</span>
        <span className="text-white text-xs flex-1 truncate">{team.teamName}</span>
        <GradeBadge grade={team.disciplineGrade} />
        <span className="text-white/30 text-xs w-6 text-right">{team.disciplineScore}</span>
        {expanded ? (
          <ChevronUp className="w-3 h-3 text-white/30 shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 text-white/30 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-white/4 p-2">
            <div className="text-white/40 text-[10px] mb-1">Walk Rate</div>
            <div className="text-white text-sm font-bold">{team.walkRate.toFixed(1)}%</div>
            <div className="text-white/40 text-[10px] mt-0.5">
              vs RHP: {team.walkRateVsRHP.toFixed(1)}% · LHP: {team.walkRateVsLHP.toFixed(1)}%
            </div>
          </div>
          <div className="rounded-lg bg-white/4 p-2">
            <div className="text-white/40 text-[10px] mb-1">Strikeout Rate</div>
            <div className="text-white text-sm font-bold">{team.strikeoutRate.toFixed(1)}%</div>
            <div className="text-white/40 text-[10px] mt-0.5">
              vs RHP: {team.kRateVsRHP.toFixed(1)}% · LHP: {team.kRateVsLHP.toFixed(1)}%
            </div>
          </div>
          <div className="rounded-lg bg-white/4 p-2">
            <div className="text-white/40 text-[10px] mb-1">Pitches/PA</div>
            <div className="text-white text-sm font-bold">{team.pitchesPerPA.toFixed(2)}</div>
          </div>
          <div className="rounded-lg bg-white/4 p-2">
            <div className="text-white/40 text-[10px] mb-1">Walk Boost</div>
            <div className={`text-sm font-bold ${team.walkBoostBps >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {team.walkBoostBps >= 0 ? "+" : ""}{(team.walkBoostBps / 100).toFixed(1)}%
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Leaderboard Section ───────────────────────────────────────────────────────
function LeaderboardSection({
  title,
  icon: Icon,
  teams,
  metric,
  metricLabel,
  color,
}: {
  title: string;
  icon: any;
  teams: any[];
  metric: string;
  metricLabel: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/4 overflow-hidden">
      <div className={`flex items-center gap-2 px-3 py-2.5 border-b border-white/8 bg-gradient-to-r ${color}`}>
        <Icon className="w-3.5 h-3.5 text-white/70" />
        <span className="text-white text-xs font-semibold">{title}</span>
      </div>
      <div>
        {teams.slice(0, 5).map((team, i) => (
          <div key={team.teamAbbr} className="flex items-center gap-2 px-3 py-2 border-b border-white/6 last:border-0">
            <span className="text-white/30 text-xs w-4">{i + 1}</span>
            <span className="text-white/60 text-xs font-mono w-8">{team.teamAbbr}</span>
            <span className="text-white text-xs flex-1 truncate">{team.teamName}</span>
            <GradeBadge grade={team.disciplineGrade} />
            <span className="text-white/60 text-xs font-mono">
              {typeof (team as any)[metric] === "number"
                ? `${((team as any)[metric] as number).toFixed(1)}${metricLabel}`
                : (team as any)[metric]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Edge History Row ──────────────────────────────────────────────────────────
function EdgeHistoryRow({ rec }: { rec: any }) {
  const resultColor =
    rec.result === "hit" ? "text-emerald-400" :
    rec.result === "miss" ? "text-red-400" :
    "text-white/40";

  return (
    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/6 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-white text-xs font-semibold truncate">{rec.pitcherName}</span>
          <span className="text-white/30 text-[10px]">vs</span>
          <span className="text-white/60 text-xs">{rec.opponentTeam}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-white/40 text-[10px]">{rec.gameDate}</span>
          <span className="text-white/40 text-[10px] capitalize">{rec.propType.replace("_", " ")}</span>
          {rec.line && <span className="text-white/40 text-[10px]">Line: {rec.line}</span>}
          {rec.tms && <span className="text-blue-400/70 text-[10px]">TMS {rec.tms}</span>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        {rec.disciplineGrade && <GradeBadge grade={rec.disciplineGrade} />}
        <span className={`text-xs font-bold capitalize ${resultColor}`}>
          {rec.result === "pending" ? "Pending" : rec.result?.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function PitchersTab() {
  const { data: matchups, isLoading: matchupsLoading } = trpc.discipline.getTodayPitcherMatchups.useQuery();
  const { data: grades, isLoading: gradesLoading } = trpc.discipline.getAllTeamGrades.useQuery();
  const { data: leaderboards, isLoading: lbLoading } = trpc.discipline.getLeaderboards.useQuery();
  const { data: edgeHistory, isLoading: histLoading } = trpc.discipline.getEdgeHistory.useQuery();

  const isLoading = matchupsLoading || gradesLoading || lbLoading || histLoading;

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-6">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <FlaskConical className="w-5 h-5 text-purple-400" />
          <h1 className="text-white text-lg font-bold">Diamond Discipline DB</h1>
        </div>
        <p className="text-white/40 text-xs leading-relaxed">
          Proprietary team plate discipline grades, Team Matchup Scores (TMS), and pitcher edge intelligence.
        </p>
      </div>

      <Tabs defaultValue="matchups" className="flex-1 flex flex-col">
        <TabsList className="mx-4 mb-3 grid grid-cols-4 bg-white/6 rounded-xl h-8 shrink-0">
          <TabsTrigger value="matchups" className="text-[10px] rounded-lg data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-300">
            Today
          </TabsTrigger>
          <TabsTrigger value="grades" className="text-[10px] rounded-lg data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-300">
            Grades
          </TabsTrigger>
          <TabsTrigger value="leaderboards" className="text-[10px] rounded-lg data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-300">
            Leaders
          </TabsTrigger>
          <TabsTrigger value="history" className="text-[10px] rounded-lg data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-300">
            Edge Log
          </TabsTrigger>
        </TabsList>

        {/* ── Today's Matchups ─────────────────────────────────────────────── */}
        <TabsContent value="matchups" className="flex-1 overflow-y-auto px-4 space-y-3 mt-0">
          {matchupsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="rounded-xl border border-white/8 bg-white/4 p-3 animate-pulse">
                  <div className="h-4 w-32 bg-white/10 rounded mb-3" />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="h-20 bg-white/6 rounded-lg" />
                    <div className="h-20 bg-white/6 rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          ) : !matchups || matchups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Activity className="w-8 h-8 text-white/20 mb-3" />
              <p className="text-white/40 text-sm">No games scheduled today</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-1">
                <Activity className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-white/60 text-xs font-semibold">
                  {matchups.length} Games · TMS = Team Matchup Score (0–100)
                </span>
              </div>
              {matchups.map((m: any) => (
                <PitcherMatchupCard key={m.gameId} matchup={m} />
              ))}
            </>
          )}
        </TabsContent>

        {/* ── Team Discipline Grades ────────────────────────────────────────── */}
        <TabsContent value="grades" className="flex-1 overflow-y-auto px-4 mt-0">
          {gradesLoading ? (
            <div className="space-y-1 animate-pulse">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-10 bg-white/4 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-white/8 bg-white/4 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/8 bg-gradient-to-r from-purple-500/10 to-transparent">
                <Trophy className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-white text-xs font-semibold">All 30 Teams — Discipline Rankings</span>
                <span className="ml-auto text-white/30 text-[10px]">Tap row for details</span>
              </div>
              <div className="flex items-center gap-3 px-3 py-1.5 border-b border-white/6 bg-white/2">
                <span className="text-white/30 text-[10px] w-5 text-right">#</span>
                <span className="text-white/30 text-[10px] w-8">ABR</span>
                <span className="text-white/30 text-[10px] flex-1">Team</span>
                <span className="text-white/30 text-[10px]">Grade</span>
                <span className="text-white/30 text-[10px] w-6 text-right">Pts</span>
                <span className="w-3" />
              </div>
              {(grades ?? []).map((team: any, i: number) => (
                <TeamGradeRow key={team.teamAbbr} team={team} rank={i + 1} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Leaderboards ─────────────────────────────────────────────────── */}
        <TabsContent value="leaderboards" className="flex-1 overflow-y-auto px-4 space-y-3 mt-0">
          {lbLoading ? (
            <div className="space-y-3 animate-pulse">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-40 bg-white/4 rounded-xl" />
              ))}
            </div>
          ) : leaderboards ? (
            <>
              <LeaderboardSection
                title="Top Walk Teams (BB Tendency)"
                icon={TrendingUp}
                teams={leaderboards.topWalkTeams}
                metric="walkRate"
                metricLabel="%"
                color="from-blue-500/10 to-transparent"
              />
              <LeaderboardSection
                title="Top Strikeout Teams (K Tendency)"
                icon={Zap}
                teams={leaderboards.topStrikeoutTeams}
                metric="strikeoutRate"
                metricLabel="%"
                color="from-orange-500/10 to-transparent"
              />
              <LeaderboardSection
                title="Most Patient Lineups"
                icon={Shield}
                teams={leaderboards.mostPatientTeams}
                metric="pitchesPerPA"
                metricLabel=" P/PA"
                color="from-emerald-500/10 to-transparent"
              />
              <LeaderboardSection
                title="Most Aggressive Lineups"
                icon={Target}
                teams={leaderboards.mostAggressiveTeams}
                metric="aggressiveScore"
                metricLabel=""
                color="from-red-500/10 to-transparent"
              />
              <LeaderboardSection
                title="Dual-Edge Opportunities"
                icon={Activity}
                teams={leaderboards.dualEdgeTeams}
                metric="disciplineScore"
                metricLabel=""
                color="from-purple-500/10 to-transparent"
              />
            </>
          ) : null}
        </TabsContent>

        {/* ── Edge History ──────────────────────────────────────────────────── */}
        <TabsContent value="history" className="flex-1 overflow-y-auto px-4 mt-0">
          {histLoading ? (
            <div className="space-y-1 animate-pulse">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-14 bg-white/4 rounded-lg" />
              ))}
            </div>
          ) : !edgeHistory || edgeHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <History className="w-8 h-8 text-white/20 mb-3" />
              <p className="text-white/40 text-sm font-medium mb-1">No Edge History Yet</p>
              <p className="text-white/25 text-xs max-w-[200px]">
                Discipline Edge picks will appear here as the system learns from pitcher vs team matchups.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-white/8 bg-white/4 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/8 bg-gradient-to-r from-purple-500/10 to-transparent">
                <span className="text-purple-400 text-sm">💎</span>
                <span className="text-white text-xs font-semibold">Discipline Edge Pick History</span>
              </div>
              {edgeHistory.map((rec: any) => (
                <EdgeHistoryRow key={rec.id} rec={rec} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Methodology note */}
      <div className="mx-4 mt-3 px-3 py-2.5 rounded-xl border border-white/6 bg-white/2 flex items-start gap-2 shrink-0">
        <AlertCircle className="w-3.5 h-3.5 text-white/30 shrink-0 mt-0.5" />
        <p className="text-white/30 text-[10px] leading-relaxed">
          TMS (Team Matchup Score) combines team discipline grade, handedness splits, recent form, umpire profile, weather, and park factors. Grades update every 6 hours from MLB Stats API. Discipline Edge fires when 2+ signals align.
        </p>
      </div>
    </div>
  );
}
