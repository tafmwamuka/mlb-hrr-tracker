# MLB HRR Tracker — Project TODO

## Phase 1: Core Leaderboard (Completed)
- [x] Initialize web-static project with MLB Stats API integration
- [x] Build mobile-first H/R/RBI leaderboard with live 2025 season data
- [x] Create podium section for top 3 players with headshots
- [x] Add bottom tab navigation for Hits/Runs/RBI switching
- [x] Build player detail modal with full stats
- [x] Implement stat bars and secondary stats display

## Phase 2: Full-Stack Upgrade & Prop Lines (In Progress)
- [x] Upgrade to web-db-user (backend + database + auth)
- [x] Integrate ballpark.com API for park-adjusted stats (RC, HR, XB, 1B, BB, K)
- [x] Integrate third-party odds aggregator API (The Odds API or similar) for Bet365 props
- [x] Build prop line prediction model with 80% hit rate accuracy
- [x] Create daily scheduled job to fetch and update prop lines
- [x] Build prop lines page with today's matchups and predictions
- [x] Add confidence scores and hit rate tracking to prop predictions
- [x] Store historical prop data in database for model training

## Phase 3: UI & Features
- [x] Create props page layout (matchup cards, player props, odds display)
- [ ] Add game schedule section showing today's MLB games
- [ ] Implement player search/filter across leaderboard and props
- [ ] Add "My Players" watchlist feature with star bookmarking
- [ ] Build settings page for prop model preferences
- [ ] Add notification system for high-confidence prop recommendations
- [x] Add favorites/plays tracking system with star icons
- [x] Add favorite toggle state and visual feedback on Props page
- [x] Fix top 3 plays to only show today's plays
- [x] Create Favorites page showing top 3 plays of the day
- [x] Build plays history with hit/miss tracking
- [ ] Display model hit rate alongside personal hit rate on Favorites page (UI refinement)
- [ ] Add matchup cards with away/home team context to Props page (UI refinement)
- [ ] Display actual sportsbook odds/prices on Props page (UI refinement)

## Phase 4: Advanced Data Integration (In Progress)
- [x] Fetch ERA data from MLB Stats API for pitchers
- [x] Fetch ISO (Isolated Power) data from MLB Stats API for batters
- [x] Integrate ERA + ISO into prop prediction model
- [ ] Fetch pitcher/batter handedness from MLB Stats API
- [ ] Fetch batter position and apply position-based adjustments
- [ ] Calculate recent form (last 15 games stats)
- [ ] Fetch pitcher workload (innings pitched recently)
- [ ] Get ballpark-specific player stats
- [ ] Integrate platoon splits (vs RHP/LHP)
- [ ] Add weather data (wind, temperature) integration
- [ ] Track rest days and fatigue
- [ ] Fetch injury status from MLB API
- [ ] Update daily job to include all data sources
- [ ] Integrate all factors into confidence calculation
- [ ] Test improved accuracy with full data model
- [ ] Display matchup context on Props page

## Phase 5: Testing & Optimization
- [ ] Write vitest tests for prop prediction model
- [ ] Test daily update scheduler
- [ ] Validate 80% hit rate on historical data
- [ ] Performance optimization for large datasets
- [ ] Mobile responsiveness testing

## Phase 5: Deployment
- [ ] Save checkpoint before publishing
- [ ] Deploy to production
- [ ] Monitor prop line accuracy and update model as needed


## Phase 6: Slugging Percentage (Slg %) Feature
- [x] Update useMLBStats hook to fetch Slg % data from MLB Stats API
- [x] Update PlayerStat type to include slg field
- [x] Add Slg % to STAT_CONFIG in Home.tsx with icon and color
- [x] Fix getStatValue to handle string values (slg and avg)
- [x] Add Slg % to PlayerModal stats display
- [ ] Add Slg % as 4th tab in bottom navigation
- [ ] Update secondary stats display to show H/R/RBI/Slg % on all player rows
- [ ] Add Slg % to prop prediction model
- [ ] Update daily-props job to generate Slg % predictions
- [ ] Add Slg % props to Props page display
- [ ] Test Slg % leaderboard functionality
- [ ] Test Slg % prop predictions
- [ ] Verify Slg % can be favorited like other stats

## Phase 7: Home Page Redesign with 5 Tabs
- [x] Create Games tab component to show today's MLB games
- [x] Create Results tab component to show past games and final stats
- [x] Create Top Plays tab showing AI picks with confidence scores
- [x] Create games router with tRPC procedures for fetching games
- [x] Redesign Home.tsx with horizontal tab navigation (Top Plays, Leaderboard, Games, Results, AI Props)
- [x] Add tab indicator with active state styling
- [x] Test all tabs load correctly
- [x] Verify AI picks display with confidence scores and matchup data
- [x] Test navigation between tabs
- [x] Write and pass 7 vitest tests for games router


## Phase 8: Games Tab Fix & All Plays Tab Implementation
- [x] Debug Games tab - verify MLB API response structure and data parsing
- [x] Fix games router to correctly parse MLB API response (direct array of games)
- [x] Test Games tab with real MLB API data
- [x] Create ballpark.com router for batter vs pitcher matchup data with RC ranking
- [x] Implement RC-based ranking algorithm (top play to ranking 10)
- [x] Build All Plays tab component with matchup cards and stats display
- [x] Display park-adjusted stats (RC, HR, XB, 1B, BB, K) on All Plays
- [x] Add All Plays tab to Home page navigation (between Top Plays and Leaderboard)
- [x] Create All Plays component with color-coded ranks (1-10)
- [x] Test All Plays data fetching and display
- [x] Verify ranking algorithm works correctly (1-10 with color coding)
- [x] Write and pass 7 vitest tests for games router
- [x] Write and pass 8 vitest tests for ballpark router
- [x] Fix and pass all 27 vitest tests across all routers


## Phase 9: Comprehensive AI Picks & Data Integration
- [x] Integrate HR Targets (hrtargets.com) data source into ranking algorithm
- [x] Create AI ranking service combining all data sources
- [x] Rebuild AI ranking algorithm with all 6 factors:
  - [x] RC (Runs Created) from ballpark.com (20% weight)
  - [x] Player historical stats (batting avg, power, OBP) (20% weight)
  - [x] Park factors (dimensions, weather) (15% weight)
  - [x] HR Targets predictions (20% weight)
  - [x] Pitcher matchup data (15% weight)
  - [x] Batting position weighting (10% weight)
- [x] Update AI picks to show OVER props only
- [x] Add reasoning/explanation for each AI pick
- [x] Display factor breakdown with 6 progress bars on AI picks
- [x] Create aiPicks router with comprehensive picks procedures
- [x] Update TopPlaysTab with expanded details and factor breakdown
- [x] Write and pass 12 vitest tests for AI ranking service
- [x] Test AI ranking with all data sources integrated

## Phase 10: UI Improvements Complete
- [x] Fix leaderboard tab toggle for Hits/Runs/RBIs/Slg % (working correctly)
- [x] Remove Games tab from Home page navigation (now 4 tabs)
- [x] Update TAB_CONFIG to remove games entry
- [x] Verify navigation buttons update correctly
- [x] Test remaining tabs (Top Plays, All Plays, Leaderboard, Results)
- [x] Add batting position to player data model
- [x] Weight AI picks by batting position (10% factor)
- [x] Maximize recommendations based on position
- [x] Test position-based weighting in AI algorithm
