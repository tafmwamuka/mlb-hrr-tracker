#!/usr/bin/env python3
"""
Pybaseball Statcast data fetcher.
Called by pybaseballService.ts via child_process.
Outputs JSON to stdout.

Usage: python3 fetch_statcast.py [year]

Output shape:
  {
    year: number,
    players: StatcastPlayer[],   // batter-side data
    pitchers: StatcastPitcher[], // pitcher-side xwOBA-against, xBA-against
    count: number,
    pitcherCount: number,
  }
"""

import sys
import json
import warnings
warnings.filterwarnings('ignore')

try:
    import pybaseball
    pybaseball.cache.enable()
except ImportError:
    print(json.dumps({"error": "pybaseball not installed", "players": [], "pitchers": []}))
    sys.exit(0)

from datetime import datetime
year = int(sys.argv[1]) if len(sys.argv) > 1 else datetime.now().year

players = {}
pitchers = {}

# ── 1. Exit velocity + barrels (batters) ─────────────────────────────────────
try:
    evb = pybaseball.statcast_batter_exitvelo_barrels(year, minBBE=20)
    for _, row in evb.iterrows():
        pid = int(row['player_id'])
        name_raw = str(row.get('last_name, first_name', ''))
        # Convert "Judge, Aaron" → "Aaron Judge"
        parts = name_raw.split(', ', 1)
        name = f"{parts[1]} {parts[0]}" if len(parts) == 2 else name_raw
        players[pid] = {
            'playerId': pid,
            'playerName': name,
            'exitVelocity': float(row.get('avg_hit_speed', 0) or 0),
            'maxExitVelocity': float(row.get('max_hit_speed', 0) or 0),
            'barrelPct': float(row.get('brl_percent', 0) or 0),
            'barrelPA': float(row.get('brl_pa', 0) or 0),
            'hardHitPct': float(row.get('ev95percent', 0) or 0),  # EV95+ = hard hit %
            'sweetSpotPct': float(row.get('anglesweetspotpercent', 0) or 0),
            'xwOBA': None,
            'xBA': None,
            'xSLG': None,
            'xwOBAPercentile': None,
            'barrelPercentile': None,
            'exitVeloPercentile': None,
            'hardHitPercentile': None,
            'sprintSpeedPercentile': None,
        }
except Exception as e:
    sys.stderr.write(f"[pybaseball] exitvelo_barrels error: {e}\n")

# ── 2. Expected stats (xBA, xSLG, xwOBA) for batters ─────────────────────────
try:
    exp = pybaseball.statcast_batter_expected_stats(year)
    for _, row in exp.iterrows():
        pid = int(row['player_id'])
        if pid in players:
            players[pid]['xwOBA'] = float(row.get('est_woba', 0) or 0)
            players[pid]['xBA'] = float(row.get('est_ba', 0) or 0)
            players[pid]['xSLG'] = float(row.get('est_slg', 0) or 0)
except Exception as e:
    sys.stderr.write(f"[pybaseball] expected_stats error: {e}\n")

# ── 3. Percentile ranks (0-100 percentile scores) for batters ────────────────
try:
    pcts = pybaseball.statcast_batter_percentile_ranks(year)
    for _, row in pcts.iterrows():
        pid = int(row['player_id'])
        if pid in players:
            players[pid]['xwOBAPercentile'] = float(row.get('xwoba', 50) or 50)
            players[pid]['barrelPercentile'] = float(row.get('brl_percent', 50) or 50)
            players[pid]['exitVeloPercentile'] = float(row.get('exit_velocity', 50) or 50)
            players[pid]['hardHitPercentile'] = float(row.get('hard_hit_percent', 50) or 50)
            players[pid]['sprintSpeedPercentile'] = float(row.get('sprint_speed', 50) or 50)
        else:
            # Player in percentile ranks but not in exit velo (fewer PA)
            name_raw = str(row.get('player_name', ''))
            parts = name_raw.split(', ', 1)
            name = f"{parts[1]} {parts[0]}" if len(parts) == 2 else name_raw
            players[pid] = {
                'playerId': pid,
                'playerName': name,
                'exitVelocity': 0,
                'maxExitVelocity': 0,
                'barrelPct': 0,
                'barrelPA': 0,
                'hardHitPct': 0,
                'sweetSpotPct': 0,
                'xwOBA': None,
                'xBA': None,
                'xSLG': None,
                'xwOBAPercentile': float(row.get('xwoba', 50) or 50),
                'barrelPercentile': float(row.get('brl_percent', 50) or 50),
                'exitVeloPercentile': float(row.get('exit_velocity', 50) or 50),
                'hardHitPercentile': float(row.get('hard_hit_percent', 50) or 50),
                'sprintSpeedPercentile': float(row.get('sprint_speed', 50) or 50),
            }
except Exception as e:
    sys.stderr.write(f"[pybaseball] percentile_ranks error: {e}\n")

# ── 4. Pitcher expected stats (xwOBA-against, xBA-against) ───────────────────
# This is the key data for the xwOBA VS gate:
#   pitcher xwOBA-against = how well batters "should" hit this pitcher
#   Low xwOBA-against = elite suppressor (bad matchup for batters)
#   High xwOBA-against = hittable pitcher (good matchup for batters)
try:
    pitcher_exp = pybaseball.statcast_pitcher_expected_stats(year)
    for _, row in pitcher_exp.iterrows():
        pid = int(row['player_id'])
        name_raw = str(row.get('last_name, first_name', ''))
        parts = name_raw.split(', ', 1)
        name = f"{parts[1]} {parts[0]}" if len(parts) == 2 else name_raw
        pitchers[pid] = {
            'pitcherId': pid,
            'pitcherName': name,
            'xwOBAAgainst': float(row.get('est_woba', 0.320) or 0.320),  # league avg ~.320
            'xBAAgainst': float(row.get('est_ba', 0.250) or 0.250),
            'xSLGAgainst': float(row.get('est_slg', 0.400) or 0.400),
            'pa': int(row.get('pa', 0) or 0),
        }
except Exception as e:
    sys.stderr.write(f"[pybaseball] pitcher_expected_stats error: {e}\n")

# ── 5. Pitcher percentile ranks (xwOBA suppression percentile) ───────────────
try:
    pitcher_pcts = pybaseball.statcast_pitcher_percentile_ranks(year)
    for _, row in pitcher_pcts.iterrows():
        pid = int(row['player_id'])
        if pid in pitchers:
            # xwOBA percentile for pitchers: higher = WORSE (more hittable)
            # We store it as-is; the VS gate inverts it (low xwOBA pct = elite suppressor)
            pitchers[pid]['xwOBAPercentile'] = float(row.get('xwoba', 50) or 50)
            pitchers[pid]['barrelPercentile'] = float(row.get('brl_percent', 50) or 50)
            pitchers[pid]['hardHitPercentile'] = float(row.get('hard_hit_percent', 50) or 50)
except Exception as e:
    sys.stderr.write(f"[pybaseball] pitcher_percentile_ranks error: {e}\n")

import math

def sanitize(v):
    """Replace NaN/Inf with None so JSON is valid."""
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v

clean_players = [
    {k: sanitize(v) for k, v in p.items()}
    for p in players.values()
]

clean_pitchers = [
    {k: sanitize(v) for k, v in p.items()}
    for p in pitchers.values()
]

result = {
    "year": year,
    "players": clean_players,
    "pitchers": clean_pitchers,
    "count": len(clean_players),
    "pitcherCount": len(clean_pitchers),
}

print(json.dumps(result))
