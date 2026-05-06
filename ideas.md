# MLB Hit · Run · RBI Tracker — Design Brainstorm

<response>
<idea>
**Design Movement**: Stadium Scoreboard Brutalism — raw, bold, high-contrast, inspired by classic ballpark scoreboards and vintage baseball cards.

**Core Principles**:
1. Unapologetic boldness — thick type, stark contrast, no softness
2. Data-first hierarchy — stats are the hero, everything else is scaffolding
3. Tactile texture — worn leather, chalk dust, aged paper grain
4. Monochrome-plus-one — black/off-white base with a single vivid accent (MLB red)

**Color Philosophy**: Near-black (#0D0D0D) background with cream (#F5F0E8) text, punctuated by MLB red (#D50032). Feels like a scoreboard at night — dramatic, readable from distance.

**Layout Paradigm**: Full-bleed vertical card stack. Each player occupies a horizontal "scoreboard row" with rank number in a massive type size on the left, stat columns right-aligned in monospace. No rounded corners. Hard edges only.

**Signature Elements**:
1. Oversized rank numerals (6rem+) bleeding off the left edge, partially cropped
2. Horizontal rule dividers that mimic chalk lines on a field
3. Stat badges rendered as "scoreboard tiles" — square, inset, monospace

**Interaction Philosophy**: Tap a stat header to re-sort. The entire list animates like a scoreboard flip. No hover states — this is a touch-first app.

**Animation**: Scoreboard "flip" transition when switching sort columns. Cards slide in from bottom on load with staggered delay. Active sort column pulses subtly.

**Typography System**: "Bebas Neue" for rank numbers and stat values (condensed, all-caps, powerful). "IBM Plex Mono" for player names and labels (technical, precise). No decorative fonts.
</idea>
<probability>0.08</probability>
</response>

<response>
<idea>
**Design Movement**: Sports Analytics Dashboard — clean, data-dense, inspired by modern sports broadcast graphics and ESPN-style overlays.

**Core Principles**:
1. Information density without clutter — show everything, hide nothing
2. Gradient depth — layered dark blues create spatial hierarchy
3. Glowing accents — neon-adjacent highlights on key stats
4. Mobile-native feel — bottom tab navigation, swipe gestures, thumb-friendly zones

**Color Philosophy**: Deep navy (#0A1628) to midnight blue (#162447) gradient background. Electric gold (#FFD700) for Hits leaders, coral red (#FF6B6B) for Runs, emerald (#00C896) for RBIs. Each stat category owns a color identity.

**Layout Paradigm**: Tabbed leaderboard with a sticky podium section (top 3 players shown as elevated cards with headshots) above a scrollable ranked list. Bottom navigation bar for switching between H / R / RBI views.

**Signature Elements**:
1. Top-3 podium cards with player headshots, glowing border in stat color
2. Horizontal bar chart embedded in each row showing relative stat value
3. Team logo watermark faintly behind player name

**Interaction Philosophy**: Bottom tab bar for H / R / RBI. Swipe left/right to switch categories. Pull-to-refresh for live data. Smooth spring animations on all transitions.

**Animation**: Staggered list entrance (cards slide up with spring physics). Number counter animation on initial load. Tab switch triggers a horizontal slide transition.

**Typography System**: "Barlow Condensed" for stat numbers (athletic, condensed). "DM Sans" for body text (clean, modern, readable). Bold weight contrast between numbers and labels.
</idea>
<probability>0.07</probability>
</response>

<response>
<idea>
**Design Movement**: Retro Baseball Card Revival — warm, nostalgic, tactile, evoking the golden age of baseball card collecting with a modern digital twist.

**Core Principles**:
1. Warmth over coldness — amber, sepia, and cream tones throughout
2. Card metaphor — every player entry is a collectible "card" with a distinct feel
3. Serif authority — editorial typography borrowed from vintage sports magazines
4. Asymmetric energy — offset layouts, diagonal accents, non-uniform spacing

**Color Philosophy**: Warm parchment (#FDF6E3) background, deep burgundy (#7B1C2E) primary, brass gold (#C9A84C) accent. Feels like flipping through a vintage baseball almanac.

**Layout Paradigm**: Horizontal scrollable "card deck" for top players, vertical list below. Each card is slightly rotated 1-2 degrees for a physical, tactile feel. Stats displayed in a vintage box-score style grid.

**Signature Elements**:
1. Player cards with a diagonal color band in team colors
2. Box-score grid with ruled lines mimicking newspaper box scores
3. Wax seal / stamp motif for the active sort category

**Interaction Philosophy**: Tap cards to "flip" and reveal full stats. Sort by tapping stat headers styled as vintage column headers. Satisfying tactile micro-animations.

**Animation**: Card flip (CSS 3D transform) on tap. Subtle paper texture parallax on scroll. Entrance animation mimics cards being dealt from a deck.

**Typography System**: "Playfair Display" for headings and player names (authoritative, editorial). "Courier Prime" for stat numbers (typewriter authenticity). Tight tracking on all-caps labels.
</idea>
<probability>0.06</probability>
</response>

## Selected Design: Sports Analytics Dashboard (Option 2)

Deep navy background, electric stat-category colors (gold/coral/emerald), podium top-3 section, bottom tab navigation, glowing accents. This is the most appropriate for a phone-first sports stats app — it feels premium, modern, and instantly readable on a small screen.
