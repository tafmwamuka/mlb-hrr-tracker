import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { propsRouter } from "./routers/props";
import { adminRouter } from "./routers/admin";
import { favoritesRouter } from "./routers/favorites";
import { gamesRouter } from "./routers/games";
import { ballparkRouter } from "./routers/ballpark";
import { notificationsRouter } from "./routers/notifications";
import { settingsRouter } from "./routers/settings";
import { searchRouter } from "./routers/search";
import { aiPicksRouter } from "./routers/aiPicks";
import { resultsRouter } from "./routers/results";
import { scheduledRouter } from "./routers/scheduled";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  props: propsRouter,
  games: gamesRouter,
  ballpark: ballparkRouter,
  results: resultsRouter,
  aiPicks: aiPicksRouter,
  search: searchRouter,
  settings: settingsRouter,
  notifications: notificationsRouter,
  admin: adminRouter,
  favorites: favoritesRouter,
  scheduled: scheduledRouter,
});

export type AppRouter = typeof appRouter;
