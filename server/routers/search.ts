import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";

export const searchRouter = router({
  searchPlayers: publicProcedure
    .input(
      z.object({
        query: z.string().min(1),
        statType: z.enum(["hits", "runs", "rbi", "slg"]).optional(),
        limit: z.number().default(20),
      })
    )
    .query(async ({ input }) => {
      // Mock search results - in production, query database
      const mockPlayers = [
        { id: 1, name: "Aaron Judge", team: "NYY", position: "RF", stat: "RBI", value: 95 },
        { id: 2, name: "Juan Soto", team: "NYM", position: "LF", stat: "RBI", value: 88 },
        { id: 3, name: "Mookie Betts", team: "LAD", position: "RF", stat: "Hits", value: 178 },
      ];

      const filtered = mockPlayers.filter(
        (p) =>
          p.name.toLowerCase().includes(input.query.toLowerCase()) ||
          p.team.toLowerCase().includes(input.query.toLowerCase())
      );

      return filtered.slice(0, input.limit);
    }),

  filterProps: publicProcedure
    .input(
      z.object({
        statType: z.enum(["hits", "runs", "rbi", "slg"]).optional(),
        confidenceMin: z.number().min(0).max(100).optional(),
        team: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      // Mock filtered props - in production, query database
      const mockProps = [
        { id: 1, player: "Aaron Judge", stat: "RBI", confidence: 94, line: 4.5 },
        { id: 2, player: "Juan Soto", stat: "RBI", confidence: 88, line: 3.5 },
        { id: 3, player: "B. Buxton", stat: "Slg %", confidence: 83, line: 0.450 },
      ];

      return mockProps.filter((p) => {
        if (input.statType && p.stat.toLowerCase() !== input.statType) return false;
        if (input.confidenceMin && p.confidence < input.confidenceMin) return false;
        return true;
      });
    }),
});
