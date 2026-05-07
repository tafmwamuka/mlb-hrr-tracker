import { useEffect, useRef } from "react";
import { useNotifications } from "@/contexts/NotificationContext";
import { usePushNotifications } from "@/_core/hooks/usePushNotifications";
import { trpc } from "@/lib/trpc";

/**
 * Hook that manages all notification triggers
 * - New top plays added
 * - Favorite player has a game
 * - Odds change significantly
 * - Daily update completed
 */
export function useNotificationTriggers() {
  const { addNotification } = useNotifications();
  const { sendLocalNotification } = usePushNotifications();
  const lastCheckedRef = useRef<{
    topPlays: string[];
    favoriteGames: string[];
    oddsChanges: Map<string, number>;
    lastUpdate: number;
  }>({
    topPlays: [],
    favoriteGames: [],
    oddsChanges: new Map(),
    lastUpdate: 0,
  });

  // Fetch top plays and check for new ones
  const { data: topPlays } = trpc.aiPicks.getComprehensivePicks.useQuery(undefined, {
    refetchInterval: 60000, // Check every minute
  });

  // Fetch favorite players
  const { data: favorites } = trpc.favorites.getAllFavorites.useQuery(undefined, {
    refetchInterval: 120000, // Check every 2 minutes
  });

  // Fetch matchups for favorite player games
  const { data: matchups } = trpc.ballpark.getMatchups.useQuery(undefined, {
    refetchInterval: 120000, // Check every 2 minutes
  });

  // Trigger: New top plays added
  useEffect(() => {
    if (!topPlays || topPlays.length === 0) return;

    const currentTopPlays = topPlays.slice(0, 5).map((p) => `${p.playerId}-${p.statType}`);
    const lastTopPlays = lastCheckedRef.current.topPlays;

    // Check if there are new plays
    const newPlays = currentTopPlays.filter((p) => !lastTopPlays.includes(p));

    if (newPlays.length > 0 && lastTopPlays.length > 0) {
      const topPlay = topPlays[0];
      const message = `${topPlay.playerName} is now #1 with ${topPlay.confidence}% confidence`;

      addNotification({
        type: "new-plays",
        title: "🔥 New Top Plays",
        message,
        dismissible: true,
        action: {
          label: "View",
          onClick: () => {
            window.location.href = "/props";
          },
        },
      });

      sendLocalNotification({
        title: "🔥 New Top Plays",
        message,
        type: "new-plays",
      });
    }

    lastCheckedRef.current.topPlays = currentTopPlays;
  }, [topPlays, addNotification, sendLocalNotification]);

  // Trigger: Favorite player has a game
  useEffect(() => {
    if (!favorites || !matchups) return;

    const favoriteIds = new Set(favorites.map((f) => f.playerId));
    const gamesWithFavorites = matchups
      .filter((m) => favoriteIds.has(m.playerId))
      .map((m) => `${m.playerId}-${m.gameId || "today"}`);

    const lastGames = lastCheckedRef.current.favoriteGames;
    const newGames = gamesWithFavorites.filter((g) => !lastGames.includes(g));

    if (newGames.length > 0 && lastGames.length > 0) {
      const firstGame = matchups.find((m) => favoriteIds.has(m.playerId));
      if (firstGame) {
        const message = `${firstGame.playerName} has a game today vs ${firstGame.pitcher?.name || "opponent"}`;

        addNotification({
          type: "favorite-game",
          title: "⭐ Favorite Player Game",
          message,
          dismissible: true,
          action: {
            label: "View",
            onClick: () => {
              window.location.href = "/favorites";
            },
          },
        });

        sendLocalNotification({
          title: "⭐ Favorite Player Game",
          message,
          type: "favorite-game",
        });
      }
    }

    lastCheckedRef.current.favoriteGames = gamesWithFavorites;
  }, [favorites, matchups, addNotification, sendLocalNotification]);

  // Trigger: Odds change significantly (>5% change)
  useEffect(() => {
    if (!topPlays) return;

    const oddsMap = new Map<string, number>();
    topPlays.forEach((play) => {
      oddsMap.set(`${play.playerId}-${play.statType}`, play.confidence);
    });

    const lastOdds = lastCheckedRef.current.oddsChanges;
    const significantChanges: Array<{ key: string; oldOdds: number; newOdds: number }> = [];

    oddsMap.forEach((newOdds, key) => {
      const oldOdds = lastOdds.get(key);
      if (oldOdds && Math.abs(newOdds - oldOdds) >= 5) {
        significantChanges.push({ key, oldOdds, newOdds });
      }
    });

    if (significantChanges.length > 0) {
      const change = significantChanges[0];
      const direction = change.newOdds > change.oldOdds ? "📈" : "📉";
      const message = `Odds changed ${direction} ${Math.abs(change.newOdds - change.oldOdds).toFixed(0)}% on ${change.key}`;

      addNotification({
        type: "odds-change",
        title: "⚡ Odds Changed",
        message,
        dismissible: true,
        action: {
          label: "View",
          onClick: () => {
            window.location.href = "/props";
          },
        },
      });

      sendLocalNotification({
        title: "⚡ Odds Changed",
        message,
        type: "odds-change",
      });
    }

    lastCheckedRef.current.oddsChanges = oddsMap;
  }, [topPlays, addNotification, sendLocalNotification]);

  // Trigger: Daily update completed
  useEffect(() => {
    const now = Date.now();
    const lastUpdate = lastCheckedRef.current.lastUpdate;
    const sixHoursAgo = now - 6 * 60 * 60 * 1000;

    // Check if it's been more than 6 hours since last update notification
    if (lastUpdate < sixHoursAgo) {
      // Check if it's around 6 AM or 11 AM
      const hour = new Date().getHours();
      if (hour === 6 || hour === 11) {
        const message = "Daily predictions have been updated with fresh data";

        addNotification({
          type: "daily-update",
          title: "🎯 Daily Update",
          message,
          dismissible: true,
          action: {
            label: "View",
            onClick: () => {
              window.location.href = "/props";
            },
          },
        });

        sendLocalNotification({
          title: "🎯 Daily Update",
          message,
          type: "daily-update",
        });

        lastCheckedRef.current.lastUpdate = now;
      }
    }
  }, [addNotification, sendLocalNotification]);
}
