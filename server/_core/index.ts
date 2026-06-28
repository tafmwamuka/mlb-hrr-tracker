import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import scheduledBackfillRouter from "../routes/scheduledBackfill";
import { registerPicksSummaryRoute } from "../routes/picksSummaryRoute";
import { warmEnrichmentCacheOnStartup } from "../services/enrichmentCache";
import { fetchPitcherMarketData, fetchHRRMarketData } from "../services/oddsApiService";
import { startAutoGradeJob } from "../jobs/autoGradeResults";
import { startPostponedGameCleanupJob } from "../jobs/postponedGameCleanup";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // Scheduled task REST endpoints
  app.use("/api/scheduled", scheduledBackfillRouter);
  // Public picks summary endpoint (no auth required)
  registerPicksSummaryRoute(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Warm enrichment cache in background after server starts
    // This ensures the first user request gets real data instead of neutral placeholders
    setTimeout(() => {
      warmEnrichmentCacheOnStartup().catch(err => {
        console.error('[Startup] Enrichment cache warm failed:', err);
      });
    }, 2000); // 2s delay to let Vite/Express finish initializing

    // Warm pitcher odds and HRR odds caches on startup
    // Production instances start cold — pre-warming ensures Book odds and Edge are
    // available immediately on first user request without a cold-start delay.
    // forceRefresh=true bypasses the active-window gate so the cache is always
    // populated when the server boots, regardless of the current time of day.
    setTimeout(() => {
      fetchPitcherMarketData(undefined, true).then(map => {
        console.log(`[Startup] Pitcher odds cache warmed: ${map.size} pitchers`);
      }).catch(err => {
        console.error('[Startup] Pitcher odds warm failed:', err);
      });
      fetchHRRMarketData(undefined, true).then(map => {
        console.log(`[Startup] HRR odds cache warmed: ${map.size} players`);
      }).catch(err => {
        console.error('[Startup] HRR odds warm failed:', err);
      });
    }, 5000); // 5s delay — after enrichment cache starts warming

    // Start server-side auto-grade results job
    // Grades money picks against live boxscores and saves to DB every 30 min (7 PM–2 AM NDT)
    startAutoGradeJob();

    // Start postponed game cleanup job
    // Detects postponed/cancelled/suspended games every 5 min and purges their picks/results from DB
    startPostponedGameCleanupJob();
  });
}

startServer().catch(console.error);
