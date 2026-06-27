/**
 * server/routers/pitcherIntel.ts
 *
 * tRPC router for the Pitcher Intel tab.
 * Exposes ATTACK/NEUTRAL/AVOID pitcher profiles for today's slate.
 *
 * Uses buildPitchersTabData from pitcherIntelEngine.ts (MLB Stats API, no key needed).
 * Optionally enriches with Statcast data from pybaseballService.
 */

import { router, publicProcedure } from '../_core/trpc';
import { buildPitchersTabData, type PitcherStatcastEntry } from '../services/pitcherIntelEngine';
import { getStatcastData } from '../services/pybaseballService';

// Simple in-memory cache — 15 min TTL
let cachedData: Awaited<ReturnType<typeof buildPitchersTabData>> | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 15 * 60 * 1000;

export const pitcherIntelRouter = router({
  getPitcherIntelData: publicProcedure.query(async () => {
    const now = Date.now();
    if (cachedData && now - cacheTime < CACHE_TTL_MS) {
      return cachedData;
    }

    // Pull Statcast pitcher cache from pybaseballService
    let statcastCache: Map<number, PitcherStatcastEntry> | undefined;
    try {
      const sc = await getStatcastData();
      if (sc?.pitchers?.size) {
        // Convert StatcastPitcher → PitcherStatcastEntry shape
        statcastCache = new Map<number, PitcherStatcastEntry>();
        sc.pitchers.forEach((p, id) => {
          statcastCache!.set(id, {
            playerId: id,
            xwobaAgainst: p.xwOBAAgainst ?? 0.320,
            barrelPctAllowed: 8.0,   // not in StatcastPitcher, use default
            hardHitPctAllowed: 38.0, // not in StatcastPitcher, use default
            exitVeloAllowed: 89.0,   // not in StatcastPitcher, use default
          });
        });
      }
    } catch {
      // Continue without Statcast — engine uses MLB Stats API fallbacks
    }

    const data = await buildPitchersTabData(statcastCache);
    cachedData = data;
    cacheTime = now;
    return data;
  }),
});
