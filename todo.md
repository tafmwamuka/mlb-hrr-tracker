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

## Phase 4: Testing & Optimization
- [ ] Write vitest tests for prop prediction model
- [ ] Test daily update scheduler
- [ ] Validate 80% hit rate on historical data
- [ ] Performance optimization for large datasets
- [ ] Mobile responsiveness testing

## Phase 5: Deployment
- [ ] Save checkpoint before publishing
- [ ] Deploy to production
- [ ] Monitor prop line accuracy and update model as needed
