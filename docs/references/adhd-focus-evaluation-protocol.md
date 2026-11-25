# N-of-1 Evaluation & Verification Protocol for TRAUMA ADHD-Focus Plugins

Evidence-backed single-case experimental design (SCED) protocol for testing,
tuning, graduating, or retiring modular ADHD-focus UI plugins in TRAUMA. This
document pairs with [`adhd-focus-research.md`](./adhd-focus-research.md) and
defines how personal plugin experiments are measured safely, analyzed
rigorously, and reviewed periodically by Hermes.

---

## 1. Why Population A/B Tests Fail Here — and Why N-of-1 SCED Fits TRAUMA

### Why Standard A/B Tests / RCTs Are the Wrong Tool

1. **High heterogeneity of treatment effects (HTE) in ADHD.** Empirical HCI and
   clinical studies repeatedly show that attention scaffolds produce opposing
   effects across individuals:
   - Digital reading rulers improved speed or comprehension for many readers,
     yet **no single ruler style worked for everyone** (Niklaus et al., CHI '23).
   - Typography adjustments created individual speed–comprehension trade-offs
     (Llana et al., CHI EA '26).
   - Centered RSVP improved comprehension for ADHD undergraduates (+~13%
     relative to controls) while *reducing* comprehension for neurotypical
     readers (Moussaoui et al., JINS '25).
   - White/pink noise produced a small positive effect on attention tasks for
     ADHD youth/young adults ($g = 0.249$) but a negative effect for non-ADHD
     controls ($g = -0.212$; Nigg et al., JAACAP '24).
   - Structured LLM summaries helped on high-complexity texts but hurt on
     low-complexity texts (Rahman et al., NLP4PI '26).
2. **Group averages hide the individual.** Between-person RCTs and web A/B
   tests estimate an average treatment effect across a sample, require large
   $N$, and take static snapshots that miss within-person temporal dynamics
   (Dallery, Cassidy, & Raiff, 2013; McCallum et al., CHI EA '19; Kwasnicka et
   al., 2019).
3. **TRAUMA is a personal tool ($N = 1$).** The question is never *"does plugin
   X lift the mean across 1,000 users?"*—it is *"does plugin X reliably help
   this specific reader on this specific reading workload without provoking
   friction or habituation?"*

### Why N-of-1 Single-Case Experimental Design (SCED) Fits

In SCED / N-of-1 trials, the **participant serves as their own control** across
repeated measurements while the intervention is systematically introduced,
withdrawn, or alternated (Dallery et al., 2013; Kwasnicka & Naughton, 2020).
Software instrumentation makes SCED practical: passive event logging provides
high-frequency behavioral time-series data without manual diary burden
(McCallum et al., CHI EA '19).

TRAUMA adopts two complementary SCED structures aligned with What Works
Clearinghouse (WWC) design principles (Kratochwill et al., 2013; WWC v5.0):

| Design Type | Structure | Best For | Minimum Data for Decision |
|---|---|---|---|
| **ABAB Reversal (Withdrawal)** | Baseline (`A1`) → Plugin On (`B1`) → Return to Baseline (`A2`) → Plugin On (`B2`) | Stateful or slow-onset workflow plugins (inbox triage, guardrails, reading habits) where session-by-session toggling is jarring or has carryover. | $\ge 5$ sessions per phase for strong evidence ($\ge 3$ minimum with reservations), giving **3 phase transitions** (WWC standard; Kratochwill et al., 2013). |
| **Alternating-Treatments Design (ATD)** | Rapid, pseudo-randomized session-level or item-level alternation (`On` vs. `Off`, or `Style 1` vs. `Style 2` vs. `Off`) using balanced urn/block randomization (Kwasnicka et al., 2019). | Instant-onset, instant-offset presentation plugins (`reading-ruler`, `resumption-beacon`, `adaptive-ai-presenter`, typography, soundscapes). | $\ge 5$ sessions per condition ($\ge 10$ total per pairwise comparison), stratified across comparable article lengths/complexities. |

### Controlling Core N-of-1 Validity Threats

- **Novelty & Expectancy Bias (Unblinded UI):** Because visual UI plugins
  cannot be double-blinded, early sessions often show an artificial "shiny new
  tool" bump. **Mitigation:** Apply an **analytical washout** (Kwasnicka et al.,
  2019)—discard the first 2 sessions (or first 3 days for multi-week phases) of
  each new condition from effect calculations, and require passive behavioral
  metrics to corroborate subjective ratings.
- **Carryover & Slow-Onset Effects:** Plugins that change inbox state
  (`ephemeral-shelf-triage`) or break habits (`hyperfocus-guardrail`) do not
  switch off instantly. **Mitigation:** Use multi-week ABAB phases with an
  explicit washout buffer between `B1` and `A2`, rather than session-level ATD.
- **Habituation Decay:** ADHD interventions—especially timers and nudges—lose
  efficacy over time as the user tunes them out (Zhu, Yu, & Luo, CHI '26).
  **Mitigation:** Compare the first half vs. second half of Phase `B` (and `B1`
  vs. `B2`). A plugin that only works in week 1 is flagged for rotation or
  retirement.
- **Autocorrelation & Baseline Trend:** Adjacent reading sessions correlate
  (energy, medication timing, workload). **Mitigation:** Use **Tau-U**
  (Parker et al., 2011)—a non-parametric non-overlap index that handles small
  samples and optionally adjusts for monotonic baseline trend—paired with
  visual time-series inspection rather than naive $t$-tests (Kwasnicka &
  Naughton, 2020).
- **Multiple Testing / Confounding Plugins:** Testing 4 plugins simultaneously
  confounds attribution. **Mitigation:** Run **at most 1 active experiment per
  UI surface** (`reader`, `ai-pane`, `inbox`, `chrome`) at a time, and keep all
  non-tested plugins frozen during an active evaluation window.

---

## 2. RSD-Safe Measurement Framework

Evaluation itself must obey TRAUMA's emotional-safety principles (Spiel et al.,
CHI '22; Navneet et al., arXiv '26; Zhu et al., CHI '26). A telemetry system
that induces shame causes avoidance and corrupts both well-being and data.

### Hard Prohibitions (Never Implement or Surface)

- **No streak counters** (e.g., *"5-day reading streak!"* or broken-streak
  resets).
- **No unread-debt or overdue counters** (no red numeric badges, no *"47 unread
  items"* guilt banners).
- **No user performance scores or grades** (no *"Focus Score: 62/100"*, no
  daily quotas, no comparison against an idealized neurotypical baseline).
- **No mid-reading interruptions** (all prompts are deferred to natural memory
  close or section breakpoints—Hyperfocus-Safe Verification Timing; Navneet et
  al., arXiv '26).
- **No penalty for missing days or skipped pulses** (missing data is treated as
  neutral absence, never as non-compliance).

### Layer 1: Observable Passive Metrics (Silent Background Capture)

Captured automatically in local storage/DB when Experiment Logging is enabled;
never displayed as live productivity gauges during reading.

| Metric Key | Operational Definition | What It Captures |
|---|---|---|
| `session_resumption_ms` | Elapsed time (ms) from `document.visibilitychange` (`visible`) or memory reopen (after $\ge 30\text{s}$ away) to first purposeful scroll ($\ge 80\text{px}$) or pointer/key navigation. | Working-memory reload cost & re-entry friction (Jo et al., CHI '15). |
| `completion_rate` | Binary per session (`1` if max scroll depth $\ge 75\%$ AND active dwell $\ge 20\text{s}$, or explicit "finished" action; `0` otherwise). Excludes `< 15s` accidental opens. | Sustained reading follow-through without bounce. |
| `early_bounce_rate` | Binary (`1` if session closes within $15\text{–}45\text{s}$ with $< 15\%$ scroll depth on memories $> 600$ words). | Task-initiation paralysis / wall-of-text rejection. |
| `tab_switch_recovery_rate` | Among sessions with $\ge 1$ away-interval $> 30\text{s}$, fraction where the user resumes scrolling within $60\text{s}$ of returning and advances $\ge 10\%$ further instead of closing. | Interruption resilience. |
| `scroll_back_frequency` | Count of upward re-scrolls ($\ge 120\text{px}$ reversal after downward reading) normalized per 500 words of active reading. | Line-skipping, lost place, and re-reading friction. |
| `plugin_override_rate` | Fraction of sessions/replies where the user manually toggles the plugin off mid-session or switches `Adapted → Original`. | Direct behavioral signal of plugin friction or mistrust. |

### Layer 2: Low-Friction 1-Tap Pulse (Opt-In, Off by Default)

When the user closes a memory (or finishes a Psychiatrist thread) after
$\ge 45\text{s}$ of active engagement, an optional, non-blocking toast appears
for 6 seconds with three neutral buttons:

- **`Helped`** (`+1`) — made reading/thinking noticeably easier.
- **`Neutral`** (`0`) — didn't notice or made no difference.
- **`Distracting`** (`-1`) — got in the way, annoyed, or broke flow.
- *(Silent timeout / dismiss = `null`, logged as skipped with zero nagging.)*

### Passive Context Stratification (Zero User Input)

Every logged session automatically attaches lightweight context tags so
comparisons do not mix 200-word notes with 5,000-word papers:

- `word_count_bucket`: `short (<500)` | `medium (500–1500)` | `long (>1500)`
- `complexity_bucket`: `low` | `medium` | `high` (e.g., lexical density / Flesch-Kincaid grade)
- `time_of_day_bucket`: `morning` | `afternoon` | `evening` | `late_night`
- `surface`: `reader` | `ai-pane` | `inbox` | `chrome`
- `active_plugins`: list of `{ id, version, settings_hash }`

---

## 3. Plugin Test Protocols & Graduation / Kill Criteria

### Universal Decision States

Every plugin experiment evaluates into one of four explicit outcomes once the
minimum data threshold is met:

| Decision | Operational Criteria | Action |
|---|---|---|
| **Graduate (Keep Default-On)** | Primary passive metric improves with **Tau-U $\ge 0.25$** (or $\ge 15\%$ median gain in expected direction) across $\ge 2$ replications/conditions **AND** pulse is $\ge 55\%$ `Helped` with $\le 15\%$ `Distracting` **AND** no severe habituation decay in second half of phase. | Promote to user's personal default stack. |
| **Tune (Parameter Sweep)** | Passive metric improves but `Distracting` is $16\text{–}29\%$ or `plugin_override_rate` $> 25\%$, **OR** subjective `Helped` $\ge 55\%$ with flat passive metrics. | Run a targeted 10-session ATD comparing 2–3 parameter presets before deciding. |
| **Conditional Keep** | Clear benefit only within a specific context bucket (e.g., `long` or `high` complexity) while neutral/negative elsewhere. | Keep installed as manual toggle or auto-gated by context; default `off` outside target bucket. |
| **Retire / Kill** | Null or negative primary passive metric (**Tau-U $\le 0.05$**) across $\ge 2$ replications **OR** `Distracting` $\ge 30\%$ **OR** `plugin_override_rate` $\ge 50\%$ **OR** week-2 effect decays back to baseline. | Disable by default and archive plugin config. Re-test only if redesigned. |

---

### 3A. Core Starter Plugins (Phase 1 PoC)

These four plugins map to four distinct surfaces (`reader` overlay, `reader`
lifecycle, `ai-pane`, `inbox`), so up to one per surface can be piloted
cleanly without cross-surface confounding (prefer staggering start dates by
3–5 days).

#### 1. `reading-ruler` — Digital Reading Ruler & Focus Mask
- **Surface:** `reader` (viewport overlay)
- **Design:** Two-stage **ATD → ABAB**:
  - *Stage 1 (Style Sweep, ATD):* 12 sessions on `medium`/`long` memories
    rotating 3 sessions each across **Grey Bar**, **Lightbox**, **Shade**, and
    **Underline** (grounded in Niklaus et al., CHI '23) to pick the user's top
    1–2 styles.
  - *Stage 2 (Efficacy Check, ABAB or On/Off ATD):* 20 `medium`/`long` sessions
    (10 On / 10 Off, discarding first 2 On sessions as novelty washout).
- **Primary Passive Metrics:** `scroll_back_frequency` (lower is better),
  `completion_rate` (higher is better).
- **Secondary Metrics:** 1-tap pulse, `plugin_override_rate` (mid-session
  toggles off).
- **Graduation Criteria:** $\ge 20\%$ reduction in median `scroll_back_frequency`
  **or** Tau-U $\ge 0.25$ on `completion_rate`, with `Distracting` $\le 15\%$
  and `plugin_override_rate` $\le 20\%$.
- **Kill Criteria:** No reduction in `scroll_back_frequency` (Tau-U $\le 0.05$)
  and `Helped` $< 40\%$, **or** `Distracting` $\ge 30\%$ across all 4 styles.

#### 2. `resumption-beacon` — Context-Switch Resumption Beacon
- **Surface:** `reader` (scroll/visibility lifecycle)
- **Design:** **Session-level ATD** (balanced random On/Off per memory) over
  $\ge 16$ sessions that contain at least one away-interval $> 30\text{s}$
  (8+ On, 8+ Off; discard first 2 On sessions as washout). Instant onset and
  negligible carryover make ATD ideal.
- **Primary Passive Metrics:** `session_resumption_ms` (median resumption lag
  after $> 30\text{s}$ away), `tab_switch_recovery_rate`.
- **Secondary Metrics:** Jump-pill click-through rate, 1-tap pulse.
- **Graduation Criteria:** $\ge 20\%$ reduction in median
  `session_resumption_ms` (or Tau-U $\ge 0.30$) **or** $\ge +15\text{pp}$ lift
  in `tab_switch_recovery_rate`, with `Distracting` $\le 15\%$.
- **Tune Trigger:** Resumption lag improves, but auto-fade is too fast/slow or
  previous+current sentence highlight feels intrusive → sweep fade duration
  (3s vs. 6s) and cue style (sentence pair vs. 3-line block; Jo et al., CHI '15).
- **Kill Criteria:** Median `session_resumption_ms` unchanged or slower
  (Tau-U $\le 0.05$), jump-pill ignored in $> 85\%$ of returns, or
  `Distracting` $\ge 30\%$.

#### 3. `adaptive-ai-presenter` — Adaptive AI Response Restructurer
- **Surface:** `ai-pane` (Psychiatrist renderer pipeline)
- **Design:** **Thread-level ATD** (random `Adapted` default vs. `Original`
  default per new Psychiatrist thread) across $\ge 16$ threads with replies
  $> 150$ words (8+ per condition; discard first 2 `Adapted` threads).
- **Primary Passive Metrics:** Follow-up engagement depth (turns per thread),
  AI-reply read-through rate (scrolled to bottom of reply before leaving), and
  `Adapted → Original` revert rate (`plugin_override_rate`).
- **Secondary Metrics:** 1-tap pulse on thread close; stratified by
  `complexity_bucket` (per Rahman et al., NLP4PI '26).
- **Graduation Criteria:** Tau-U $\ge 0.25$ on reply read-through or follow-up
  depth, `Adapted → Original` revert rate $\le 20\%$, and `Helped` $\ge 55\%$.
- **Conditional Trigger:** Strong gain on `high` complexity / $> 300$-word
  replies but high revert rate on short/simple replies → auto-gate to replies
  $> 200$ words only.
- **Kill Criteria:** `Adapted → Original` revert rate $\ge 45\%$, or
  `Distracting` $\ge 30\%$, or reduced thread depth across both complexity
  buckets.

#### 4. `ephemeral-shelf-triage` — Ephemeral Shelf & Deferred Triage
- **Surface:** `inbox` (list view & item lifecycle)
- **Design:** **Multi-week ABAB** (14 days per phase: `A1` standard list → `B1`
  Ephemeral Shelf + 3-item Daily Pick → `A2` standard list → `B2` Ephemeral
  Shelf). Analytical washout: exclude days 1–3 of each phase to absorb
  backlog-transition carryover (Kwasnicka et al., 2019).
- **Primary Passive Metrics:** Capture-to-triage latency (time spent on save
  modal), net inbox backlog growth rate (items added minus resolved/expired per
  week), Daily Pick open-to-read conversion rate (`completion_rate` on picked
  items).
- **Secondary Metrics:** Optional once-weekly RSD-safe check-in (`Lighter` /
  `Same` / `Overwhelming`—never framed as unread count or guilt).
- **Graduation Criteria:** Backlog growth flattens or turns negative without
  dropping weekly read volume, **and** capture friction drops or Daily Pick
  conversion lifts $\ge 15\text{pp}$, **and** weekly check-in is `Lighter` in
  $\ge 3/4$ B-phase weeks.
- **Tune Trigger:** Soft-archive TTL feels too aggressive (user frequently
  rescues expired items $> 25\%$) → extend TTL from 7d → 14d or 30d.
- **Kill Criteria:** User bypasses Daily Pick $> 80\%$ of sessions, backlog
  anxiety rises (`Overwhelming` in $\ge 2$ B-phase weeks), or rescue rate
  exceeds $40\%$.

---

### 3B. Phase 2 Candidate Queue

Only enter Phase 2 experiments after the 4 Core Starter Plugins have completed
initial graduation/retirement so baseline noise stays low. *(Note: names below
match the Phase 2 queue; cross-references to [`adhd-focus-research.md`](./adhd-focus-research.md)
catalog IDs are noted where they map to broader modules.)*

| Candidate Plugin | Research Grounding & Prior | Recommended SCED | Primary Metrics | Graduation / Kill Bar |
|---|---|---|---|---|
| **`bionic-text`** *(maps to experimental toggle in `bionic-typography-lab`)* | **Null/Negative prior** (Snell, Acta Psych. '24; Možina et al., SAGE Open '25 found slower reading, no comprehension gain). | **Skeptical ATD** (10 `medium` memories: 5 On / 5 Off; zero tolerance for friction). | Reading pace (words/min), `scroll_back_frequency`, 1-tap pulse. | **Fast-Kill:** Retire immediately if pace slows $> 10\%$, `scroll_back_frequency` rises, or `Distracting` $\ge 25\%$. Graduate only if Tau-U $\ge 0.30$ AND `Helped` $\ge 65\%$. |
| **`progressive-outline`** *(relates to `saliency-skim-lens` & `temporal-landmark-bar`)* | **Strong** for grammar-preserving skim/structure scaffolds (Gu et al., CHI '24; Rahman et al., NLP4PI '26). | **ATD** on `long` ($> 1,500$ words) memories (12+ sessions, 6 On / 6 Off). | `early_bounce_rate`, `completion_rate`, outline-jump engagement. | **Graduate:** $\ge 20\%$ drop in `early_bounce_rate` or Tau-U $\ge 0.25$ on `completion_rate`. **Kill:** Outline ignored in $> 80\%$ of long reads or `Distracting` $\ge 25\%$. |
| **`dyslexia-typography`** *(maps to typography presets in `bionic-typography-lab`)* | **Strong** for individualized font/spacing; ~25–40% ADHD–dyslexia comorbidity; documented speed–accuracy trade-off (Llana et al., CHI EA '26; Niklaus et al., CHI '23). | **Multi-arm ATD** (4 presets: Sans / Serif / Mono / Slab + measure/line-height; 4 sessions each on `medium`/`long` texts). | `scroll_back_frequency`, `completion_rate`, reading pace, 1-tap pulse. | **Graduate:** Winning preset outperforms default on `scroll_back_frequency` (Tau-U $\ge 0.25$) without severe pace drop and `Helped` $\ge 55\%$. **Kill:** All presets statistically indistinguishable from default. |
| **`ambient-soundscape`** *(white/pink/brown noise or gentle ambient audio)* | **Moderate (ADHD-specific):** Meta-analysis found small benefit of white/pink noise for ADHD ($g = 0.249$) vs. harm for non-ADHD ($g = -0.212$); brown noise unstudied in RCTs (Nigg et al., JAACAP '24). Keep volume low/safe. | **ATD** (Silence vs. Pink Noise vs. Soft Ambient; 15 sessions, 5 per arm, washout first 1 session per arm). | Active dwell continuity (longest uninterrupted scroll block), `tab_switch_recovery_rate`, 1-tap pulse. | **Graduate:** $\ge 20\%$ longer uninterrupted dwell or fewer voluntary tab switches (Tau-U $\ge 0.25$) with `Distracting` $\le 15\%$. **Kill:** Audio muted/paused mid-session in $> 40\%$ of trials or `Distracting` $\ge 25\%$. |
| **`hyperfocus-guardrail`** *(maps to breakpoint nudges in `temporal-landmark-bar`)* | **Moderate**, high habituation risk (Navneet et al., arXiv '26; Zhu et al., CHI '26). Must fire **only at section breakpoints**, never mid-paragraph. | **Long-phase ABAB** (14 days per phase, 3-day washout) specifically checking week-1 vs. week-2 habituation. | Runaway-session rate (continuous dwell $> 60\text{min}$ without break), breakpoint acknowledgement rate, `Distracting` pulse. | **Graduate:** Reduces runaway sessions $\ge 25\%$ through week 2 without annoyance (`Distracting` $\le 15\%$). **Kill:** Dismissed blindly in $> 90\%$ of triggers (habituation) or `Distracting` $\ge 25\%$. |
| **`visual-timer`** *(spatial landmark / distance-traveled bar; never red countdown)* | **Moderate** for spatial landmarks; conventional countdown/Pomodoro timers habituate and provoke time anxiety (Navneet et al., arXiv '26; Zhu et al., CHI '26). | **ABAB** (10 days per phase) or **ATD** (Spatial Landmark Rail vs. Off). | `completion_rate`, `early_bounce_rate`, week-1 vs. week-2 stability, 1-tap pulse. | **Graduate:** Tau-U $\ge 0.25$ on `completion_rate` sustained across both weeks, `Distracting` $\le 15\%$. **Kill:** Habituates to baseline by week 2 or triggers any stress/`Distracting` $\ge 20\%$. |

*Catalog sync note:* Other catalog modules in [`adhd-focus-research.md`](./adhd-focus-research.md)—`semantic-hover-anchor`, `complexity-gated-scaffold`, `rsvp-micro-reader`, and `gentle-copilot-starter`—follow the same ATD template (stratified by `complexity_bucket` for `complexity-gated-scaffold` and dense $> 500$-word passages for `rsvp-micro-reader`).

---

## 4. Hermes Periodic Review Digest Workflow

Instead of the user manually eyeballing spreadsheets—or guessing which plugin
"feels" good—Hermes runs a scheduled, evidence-based review digest using
TRAUMA's local export.

### Data Contract (TRAUMA Local Export / Upcoming API)

TRAUMA exposes a read-only local export (via an upcoming local endpoint such as
`GET /api/experiments/export?since=YYYY-MM-DD` or a local NDJSON dump). Each
line represents one completed reading/AI/inbox session:

```json
{
  "session_id": "uuid",
  "timestamp": "2026-12-01T14:22:10Z",
  "surface": "reader",
  "experiment_id": "exp-reading-ruler-v1",
  "phase": "B1",
  "condition": "on",
  "is_washout": false,
  "active_plugins": [
    { "id": "reading-ruler", "settings_hash": "lightbox-3lines-55pct" }
  ],
  "context": {
    "word_count_bucket": "long",
    "complexity_bucket": "high",
    "time_of_day_bucket": "afternoon"
  },
  "passive_metrics": {
    "active_dwell_ms": 412000,
    "max_scroll_depth": 0.92,
    "completed": true,
    "early_bounce": false,
    "session_resumption_ms": 2400,
    "tab_switches": 2,
    "tab_switch_recovered": true,
    "scroll_back_per_500w": 1.4,
    "plugin_overridden": false
  },
  "pulse": "helped"
}
```

### Hermes Review Cadence & Computation Pipeline

- **Cadence:** Bi-weekly (every 14 days), triggered only when $\ge 10$
  non-washout sessions have been logged since the last digest (if fewer, Hermes
  skips silently—no guilt notification).
- **Analysis Steps:**
  1. **Clean & Filter:** Drop sessions with `active_dwell_ms < 15000` (accidental
     opens) and sessions flagged `is_washout: true` (first 2 sessions or first 3
     days of a new phase).
  2. **Stratify:** Group comparisons by `surface` and `word_count_bucket` /
     `complexity_bucket` so a plugin tested on dense papers isn't compared
     against quick notes.
  3. **Compute Effect Sizes:** For each active experiment with $\ge 5$ sessions
     per condition:
     - Median and interquartile range (IQR) of primary passive metrics (`A` vs.
       `B`).
     - **Tau-U** non-overlap score with baseline-trend check (Parker et al.,
       2011).
     - Pulse distribution (`% Helped`, `% Neutral`, `% Distracting`, `% Skipped`).
     - **Habituation check:** First-half vs. second-half `B`-phase trend.
  4. **Classify Recommendation:** Map each plugin to `Graduate`, `Tune`,
     `Conditional Keep`, `Continue Collecting (Underpowered)`, or `Retire`.

### RSD-Safe Digest Output Rules

- **Evaluate the tool, never the human.** Write *"`reading-ruler` (Lightbox)
  cut scroll-backs by 28% on long articles (Tau-U = 0.38, 7/10 Helped)"*—never
  *"You only finished 45% of your articles this week."*
- **Never print unread totals, streaks, or missed days.**
- **Deliver actionable, low-friction next steps:** End every digest with at
  most 2–3 concrete proposals (e.g., *"Graduate `reading-ruler` to default-on;
  retire `bionic-text`; start `resumption-beacon` ATD next?"*) that the user can
  accept, tweak, or ignore with a single reply.

---

## 5. Epistemic Boundary: Verified Literature vs. Local Hypotheses

To keep TRAUMA's roadmap honest, empirical findings from peer-reviewed studies
are strictly separated from local hypotheses that remain **unverified** until
tested via this N-of-1 protocol.

| Domain | Verified Literature Findings (Grounded) | Local Hypotheses to Test in TRAUMA (Unverified Until N-of-1 Data) |
|---|---|---|
| **Methodology** | N-of-1 / SCED allows causal within-person inference when using repeated measurement, $\ge 3$ phase demonstrations, washout/autocorrelation controls, and non-overlap metrics like Tau-U (Dallery et al., 2013; Kratochwill et al., 2013; Kwasnicka et al., 2019, 2020; Parker et al., 2011; McCallum et al., CHI EA '19). | A 1-tap exit pulse (`Helped` / `Neutral` / `Distracting`) paired with browser-level passive metrics (`scroll_back_frequency`, `session_resumption_ms`) will have high enough signal-to-noise ratio in real daily use to distinguish effective plugins within 14–28 days. |
| **Reading Rulers & Typography** | Digital reading rulers aid many readers with/without dyslexia, but optimal style is highly individual (Niklaus et al., CHI '23). Font choice shifts speed vs. comprehension (Llana et al., CHI EA '26). Bionic Reading shows null/negative lab results (Snell, '24; Možina et al., '25). | Which specific ruler style (Grey Bar vs. Lightbox vs. Shade vs. Underline) and typography preset reduces *this* user's `scroll_back_frequency` without causing visual annoyance on TRAUMA's SolidStart reader. |
| **Interruption Recovery** | Visual resumption cues (especially previous+current sentence or fixed-block highlights) significantly cut reading resumption lag (Jo et al., CHI '15). | Whether an automatic `visibilitychange` beacon + jump pill meaningfully reduces `session_resumption_ms` and tab-abandonment in TRAUMA's web reader compared to native browser scroll preservation. |
| **AI Presentation** | Presentation-layer restructuring with `Adapted / Original` toggling lowers working-memory load (Adapt AI, C&C '26); structured LLM summaries help on high-complexity articles but hurt on low-complexity ones (Rahman et al., NLP4PI '26). | Whether restructuring TRAUMA's Psychiatrist replies increases follow-up turn depth and read-through rate, and what exact reply-length threshold minimizes `Adapted → Original` reverts. |
| **Inbox & Emotional Safety** | Ephemeral shelves separate from emergent topic/task groups reduce saving friction and workspace overload (Gstell, CHI '26; Chang et al., CHI '21). Neutral, RSD-safe progress and breakpoint-only timing reduce cognitive load (Navneet et al., arXiv '26); timers habituate (Zhu et al., CHI '26). | Whether a 7/14/30-day TTL Ephemeral Shelf + 3-item Daily Pick stabilizes *this* user's TRAUMA backlog without causing item-rescue anxiety, and whether spatial landmarks resist habituation beyond 2 weeks. |
| **Ambient Soundscapes** | White/pink noise yields a small lab attention gain for ADHD ($g = 0.249$) and a negative effect for non-ADHD ($g = -0.212$); brown noise lacks RCT evidence (Nigg et al., JAACAP '24). | Whether subtle pink/ambient audio built into TRAUMA extends uninterrupted reading dwell during long-form web reading without inducing fatigue or mute-outs. |

---

## 6. References

### Single-Case Experimental Design & N-of-1 Methodology
- **Dallery, J., Cassidy, R. N., & Raiff, B. R. (2013).** *Single-Case Experimental Designs to Evaluate Novel Technology-Based Health Interventions.* Journal of Medical Internet Research, 15(2), e22. [`doi:10.2196/jmir.2227`](https://doi.org/10.2196/jmir.2227)
- **Kratochwill, T. R., Hitchcock, J. H., Horner, R. H., Levin, J. R., Odom, S. L., Rindskopf, D. M., & Shadish, W. R. (2013).** *Single-Case Intervention Research Design Standards.* Remedial and Special Education, 34(1), 26–38. [`doi:10.1177/0741932512452794`](https://doi.org/10.1177/0741932512452794) *(See also WWC Single-Case Design Technical Documentation, [`ies.ed.gov/ncee/wwc/Document/229`](https://ies.ed.gov/ncee/wwc/Document/229), and WWC v5.0 Key Criteria.)*
- **Kwasnicka, D., Inauen, J., Nieuwenboom, W., Nurmi, J., Schneider, A., Short, C. E., Dekkers, T., Williams, A. J., Bierbauer, W., Haukkala, A., Picariello, F., & Naughton, F. (2019).** *Challenges and solutions for N-of-1 design studies in health psychology.* Health Psychology Review, 13(2), 163–178. [`doi:10.1080/17437199.2018.1564627`](https://doi.org/10.1080/17437199.2018.1564627)
- **Kwasnicka, D., & Naughton, F. (2020).** *N-of-1 methods: A practical guide to exploring trajectories of behaviour change and designing precision behaviour change interventions.* Psychology of Sport and Exercise, 47, 101570. [`doi:10.1016/j.psychsport.2019.101570`](https://doi.org/10.1016/j.psychsport.2019.101570)
- **McCallum, C., Rooksby, J., Asadzadeh, P., Gray, C. M., & Chalmers, M. (2019).** *An N-of-1 Evaluation Framework for Behaviour Change Applications.* ACM CHI EA '19, LBW1810, 1–6. [`doi:10.1145/3290607.3312923`](https://doi.org/10.1145/3290607.3312923)
- **Parker, R. I., Vannest, K. J., Davis, J. L., & Sauber, S. B. (2011).** *Combining Nonoverlap and Trend for Single-Case Research: Tau-U.* Behavior Therapy, 42(2), 284–299. [`doi:10.1016/j.beth.2010.08.006`](https://doi.org/10.1016/j.beth.2010.08.006)

### ADHD HCI, Reading, & Assistive Technology Sources
- **Nigg, J. T., Bruton, A., Kozlowski, M. B., Johnstone, J. M., & Karalunas, S. L. (2024).** *Systematic Review and Meta-Analysis: Do White Noise or Pink Noise Help With Task Performance in Youth With Attention-Deficit/Hyperactivity Disorder or With Elevated Attention Problems?* Journal of the American Academy of Child & Adolescent Psychiatry, 63(8). [`doi:10.1016/j.jaac.2023.12.014`](https://doi.org/10.1016/j.jaac.2023.12.014)
- Additional primary HCI/cognitive studies cited in Sections 1–5 (Spiel et al., CHI '22; Niklaus et al., CHI '23; Llana et al., CHI EA '26; Jo et al., CHI '15; Gu et al., CHI '24; Rahman et al., NLP4PI '26; Adapt AI, C&C '26; Navneet et al., arXiv '26; Zhu et al., CHI '26; Chang et al., CHI '21; Gstell, CHI '26; Moussaoui et al., JINS '25; Snell, Acta Psych. '24; Možina et al., SAGE Open '25) are cataloged with full DOIs in [`adhd-focus-research.md`](./adhd-focus-research.md).
