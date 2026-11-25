# ADHD-Focus UI/UX Research and Modular Plugin Catalog

Design reference compiled from peer-reviewed HCI, cognitive psychology, and
accessibility literature (ACM CHI, C&C, ACL/NLP4PI, JINS, Acta Psychologica,
SAGE Open, Visible Language, and arXiv). This document grounds TRAUMA's
ADHD-focus design philosophy and defines modular, individually toggleable UI
plugins so users can run personal experiments and keep only what improves focus.

## 1. Key Empirical Findings and Design Principles

### A. Agency and Personalization Over Neuro-Normative Defaults

- **Spiel, K., Hornecker, E., Williams, R. M., & Good, J. (2022).** *ADHD and
  Technology Research – Investigated by Neurodivergent Readers.* ACM CHI '22.
  [`doi:10.1145/3491102.3517592`](https://doi.org/10.1145/3491102.3517592)
  - **Finding:** Critical review of ADHD HCI literature from an insider
    neurodivergent perspective showed most tools adopt deficit frames
    ("mitigating" ADHD behaviors to match neurotypical norms), rarely involve
    ADHD users in co-design, and provoke user resistance.
  - **Principle:** Every attention scaffold must be **opt-in, visible,
    inspectable, and individually toggleable**, supporting self-experimentation
    rather than enforcing one-size-fits-all focus modes.

### B. Typography, Visual Anchoring, and Eye-Movement Support

- **Llana, B., Baron, A., Yu, H., Hosseinpour, M., Suhail, Y., Chin, S.,
  Khadka, K., & Wallace, S. (2026).** *Reading with Diversity in Mind:
  Pupillometry and Typography Towards Inclusive Design for ADHD Readers.* ACM
  CHI EA '26.
  [`doi:10.1145/3772363.3799383`](https://doi.org/10.1145/3772363.3799383)
  - **Finding:** In-lab EyeLink eye-tracking/pupillometry study (N=21, 6
    meeting ASRS-v1.1 ADHD criteria) testing Roboto variants (Default,
    Monospace, Serif, Slab) across 14/16/18px. ADHD status had a large effect on
    reading speed—ADHD readers read faster with fewer saccades (broader visual
    scanning). Across all readers, a speed–comprehension trade-off emerged
    (Roboto Default fastest at ~+10% above mean but lowest accuracy ~27%; Roboto
    Serif slower with highest accuracy ~34%). Interviews emphasized
    customizable, distraction-free layouts.
- **Niklaus, A. G., Cai, T., Bylinskii, Z., & Wallace, S. (2023).** *Digital
  Reading Rulers: Evaluating Inclusively Designed Rulers for Readers With
  Dyslexia and Without.* ACM CHI '23.
  [`doi:10.1145/3544548.3581367`](https://doi.org/10.1145/3544548.3581367)
  - **Finding:** Co-designed four digital reading rulers (**Grey Bar, Lightbox,
    Shade, Underline**) and evaluated them on N=177 readers (91 with dyslexia,
    86 without; relevant given ~25–40% ADHD–dyslexia comorbidity). Measurable
    gains in reading speed and comprehension occurred across many readers, **but
    no single ruler style worked for everyone**, validating configurable style,
    height, color, and opacity.
- **Vatány, S., Nguyen, T. H., Illés, A., & Bessemans, A. (2026).** *Evaluating
  Interactive Highlighting Techniques in Digital Reading: An Empirical Study of
  Hover-Based Line, Sentence, and Paragraph Highlighting.* Visible Language,
  60(1).
  [`PDF`](https://visible-language.org/Issue-60-1/VL-60-1-Vatany-et-al.pdf)
  - **Finding (Mixed/Null on objective metrics):** In N=80 participants,
    hover-based highlighting produced **no statistically significant improvement
    in reading speed or comprehension** vs. static text. However, **sentence-
    and paragraph-level highlighting significantly increased perceived attention
    sustainment**, whereas line-level highlighting divided users.
  - **Principle:** Anchor visual focus to **semantic/grammatical units**
    (sentences/paragraphs), not arbitrary line wraps.
- **Moussaoui, S., Siddiqi, A. A., Cheung, T. C. K., & Niemeier, M. (2025).**
  *Reading without eye movements: Improving reading comprehension in young
  adults with attention-deficit/hyperactivity disorder (ADHD).* Journal of the
  International Neuropsychological Society (JINS).
  [`doi:10.1017/s1355617725101628`](https://doi.org/10.1017/s1355617725101628)
  - **Finding (Divergent ADHD vs. Neurotypical):** Comparing full text, paced
    in-place word-by-word, and centered RSVP (minimal eye movements), ADHD
    undergraduates gained **~13% comprehension in RSVP relative to neurotypical
    controls** (whose comprehension dropped under RSVP), implicating saccadic
    interference in ADHD reading.
  - **Caveat:** HCI pilot studies note RSVP removes spatial context and makes
    re-reading and punctuation harder—RSVP should only be an optional,
    pause/rewind-capable mode, never a primary view.
- **Snell, J. (2024).** *No, Bionic Reading does not work.* Acta Psychologica,
  247, 104304.
  [`doi:10.1016/j.actpsy.2024.104304`](https://doi.org/10.1016/j.actpsy.2024.104304)
  and **Možina, K., Kovačević, D., & Blaznik, B. (2025).** *Usability of Bionic
  Reading on Different Mediums: Eye-Tracking Study.* SAGE Open.
  [`doi:10.1177/21582440251376158`](https://doi.org/10.1177/21582440251376158)
  - **Finding (Null/Negative):** Snell (2024) found no reading facilitation from
    bolding word prefixes. Možina et al. (2025; N=114 eye-tracking on screen and
    paper, Georgia vs. Verdana) found Bionic Reading **lengthened reading time**
    with no consistent comprehension or memorization gain.
  - **Principle:** Do **not** ship Bionic Reading as a default or proven aid; if
    included at all, label it explicitly as an experimental opt-in toggle for
    personal comparison.

### C. Interruption Recovery and Context-Switch Resumption

- **Jo, J., Kim, B., & Seo, J. (2015).** *EyeBookmark: Assisting Recovery from
  Interruption during Reading.* ACM CHI '15.
  [`doi:10.1145/2702123.2702340`](https://doi.org/10.1145/2702123.2702340)
  - **Finding:** Controlled within-subjects study comparing four visual
    resumption cues (point marker, interrupted sentence, previous sentence,
    fixed-line block) vs. no cue after reading interruptions. Visual cues
    **significantly reduced resumption lag** across both easy and difficult
    texts; **sentence/previous-sentence and fixed-block cues** outperformed a
    bare dot because readers need surrounding context to reload working memory.

### D. AI/LLM Reading Scaffolds and Presentation-Layer Restructuring

- **Gu, Z., Arawjo, I., Li, K., Kummerfeld, J. K., & Glassman, E. L. (2024).**
  *An AI-Resilient Text Rendering Technique for Reading and Skimming Documents
  (GP-TSM).* ACM CHI '24.
  [`doi:10.1145/3613904.3642699`](https://doi.org/10.1145/3613904.3642699)
  - **Finding:** Grammar-Preserving Text Saliency Modulation dims less-essential
    words in-place while keeping the darkest subset grammatically coherent and
    leaving the full original text visible. Enables fast skimming without
    abstractive hallucination or loss of source context.
- **Rahman, A. U., Koba, S., Michal, A., & Wilson, S. R. (2026).** *Measuring
  the Impact of LLM-Generated Scientific Summaries for Neurodivergent Readers.*
  ACL NLP4PI '26.
  [`aclanthology.org/2026.nlp4pi-1.26`](https://aclanthology.org/2026.nlp4pi-1.26/)
  - **Finding (Mixed / Complexity-Dependent):** Formative study (N=10) +
    experiment (N=200 ADHD/autistic adults) testing 5 summary styles. Structured
    LLM summaries **improved comprehension on high-complexity articles** but
    **reduced comprehension on low-complexity articles** relative to extractive
    baselines. Simpler styles raised trust; cognitive load (NASA-TLX) depended
    more on baseline mental state and text complexity than summary style.
    Participants strongly wanted inline jargon definitions and structured
    chunking.
- **Adapt AI (ACM C&C '26).** *Too Long to Read? Restructuring LLM Responses
  for Users with Attention-Related Challenges.*
  [`doi:10.1145/3803784.3816862`](https://doi.org/10.1145/3803784.3816862)
  - **Finding:** Intervening at the **presentation layer**—condensing verbose
    LLM outputs into visual hierarchies with an explicit **Adapted / Original
    toggle**—reduces working-memory overload during AI conversations without
    sacrificing user control or trust.

### E. Dynamic Attention States, Time Blindness, Emotional Safety, and Habituation

- **Navneet, S. K., Chandra, J., & Zhang, Y. (2026).** *Orchestrating Attention:
  Bringing Harmony to the 'Chaos' of Neurodivergent Learning States
  (AttentionGuard).* [`arXiv:2602.07865`](https://arxiv.org/abs/2602.07865)
  - **Finding:** Wizard-of-Oz study (N=11 adults with ADHD traits) evaluating
    five adaptive UI patterns across four attention states (Focused, Drifting,
    Hyperfocused, Fatigued) significantly reduced cognitive load (NASA-TLX 47.2
    vs. 62.8, Cohen's d=1.21, p=.008) and improved comprehension (78.4% vs.
    61.2%, p=.009). Key mechanisms: **Attention-Responsive Chunking**,
    **Bi-Directional Scaffolding**, **Hyperfocus-Safe Verification Timing**
    (deferring prompts to natural breakpoints), **RSD-Safe Feedback** (neutral
    palettes, distance traveled vs. remaining, zero shame triggers), and
    **Temporal Landmark Navigation** (spatial landmarks instead of countdown
    timers).
- **Zhu, Z., Yu, J., & Luo, Y. (2026).** *Scaffolding Metacognition with GenAI:
  Exploring Design Opportunities to Support Task Management for University
  Students with ADHD.* ACM CHI '26.
  [`doi:10.1145/3772318.3790697`](https://doi.org/10.1145/3772318.3790697)
  - **Finding:** Co-design with N=20 diagnosed ADHD students + 5 clinicians.
    Conventional Pomodoro/alarm timers lose effectiveness quickly due to
    **habituation**; effective GenAI scaffolds combine task/self-awareness,
    reflective execution, and emotional regulation.
- **Chen, J., Meng, Y., & Nie, K. (2026).** *"Not Just Me and My To-Do List":
  Understanding Challenges of Task Management for Adults with ADHD and the Need
  for AI-Augmented Social Scaffolds.*
  [`arXiv:2603.17258`](https://arxiv.org/abs/2603.17258)
  - **Finding:** Interviews (N=22) + speed-dating (N=20) showed task initiation
    is affectively and relationally mediated; mechanistic checklists fail under
    emotional friction, while low-pressure conversational AI check-ins
    ("co-piloting") lower initiation paralysis.

### F. Bookmarking, Tab Hoarding, and Deferred Information Triage

- **Chang, J. C., Hahn, N., Kim, Y., Coupland, J., et al. (2021).** *When the
  Tab Comes Due: Challenges in the Cost Structure of Browser Tab Usage.* ACM
  CHI '21.
  [`doi:10.1145/3411764.3445585`](https://doi.org/10.1145/3411764.3445585)
  - **Finding:** Interviews (N=10) + survey (N=103): 30% report a "tab hoarding
    problem." Rigid bookmark hierarchies fail because premature categorization
    imposes prohibitive cognitive cost and bookmarks lose the ambient reminding
    affordance of open tabs.
- **Gstell (ACM CHI '26).** *From Tabs to Structures: Understanding and
  Supporting Web Page Management.*
  [`doi:10.1145/3772318.3791979`](https://doi.org/10.1145/3772318.3791979)
  - **Finding:** Field study (N=29 knowledge workers): separating a low-friction
    ephemeral **Shelf** (short-term uncertain items, deferred classification)
    from longer-term **Topic/Task Groups** (49.4% topic, 31.0% task)
    significantly reduced saving friction (t(28)=2.98, p<0.01, Cohen's d=0.63)
    and alleviated workspace overload.

## 2. Modular ADHD-Focus GUI Plugin Catalog

Each plugin is designed as an independent, toggleable module in TRAUMA
(SolidStart + Tailwind) with explicit configuration and a lightweight
self-experiment metric.

| # | Plugin ID & Name | Target ADHD Bottleneck | Concrete UI / Interaction Mechanism | Evidence Grounding & Strength | Configurability / Parameters | Self-Experiment Metric (On vs. Off) |
|---|---|---|---|---|---|---|
| 1 | `reading-ruler` — **Digital Reading Ruler & Focus Mask** | Visual clutter, involuntary saccades, line-skipping | Overlay following cursor or keyboard (`j`/`k`) in 4 selectable styles: **Grey Bar**, **Lightbox**, **Shade**, or **Underline**. | Niklaus et al. (CHI '23); Llana et al. (CHI EA '26) — **Strong** | Style (4 modes), window height (1–5 lines), surround dim/blur opacity (0–85%), tint color, follow mode (cursor / scroll-center / keyboard). | Self-rated eye fatigue (1–5) + % of saved memories read past 75% scroll depth. |
| 2 | `semantic-hover-anchor` — **Semantic Unit Highlighter** | Attentional drift during dense prose without a heavy mask | Hovering or tapping any paragraph/sentence softly elevates that grammatical unit (subtle left-border accent + slight de-emphasis of sibling paragraphs) rather than arbitrary wrapped lines. | Vatány et al. (Visible Language '26) — **Moderate** *(perceived focus gain; null on raw speed)* | Granularity (sentence vs. paragraph), dim strength of non-active siblings (0–40%), click-to-lock toggle. | Subjective "felt focused" rating (1–5) per reading session; frequency of re-reading same paragraph. |
| 3 | `resumption-beacon` — **Context-Switch Resumption Beacon** | Working-memory drop & resumption lag after interruptions / tab switches | Automatically tracks the last actively read paragraph (scroll dwell + IntersectionObserver or manual pin). On return after >30s away or tab refocus, renders a fade-out highlight over the **previous + current sentence** (fixed-context block) plus a 1-click "Jump to last spot" pill and optional 1-line AI recap. | Jo, Kim, & Seo (CHI '15, EyeBookmark); AttentionGuard (arXiv '26) — **Strong** | Away threshold (15s / 30s / 2m), cue style (previous+current sentence vs. 3-line block), auto-fade duration, optional 1-sentence AI recap toggle. | Time from returning to tab to first meaningful scroll/interaction (resumption lag) + subjective re-entry friction (1–5). |
| 4 | `saliency-skim-lens` — **Grammar-Preserving Saliency Skim Lens** | Initiation paralysis on walls of text; skimming guilt | Client/LLM pass scores clause saliency while preserving grammar; dims secondary modifiers/clauses in-place so the darkest text reads as a coherent skeleton. Full original prose stays intact in-place; a slider continuously dials saliency depth from 0% (raw) to 60% (skim). | Gu et al. (CHI '24, GP-TSM); Rahman et al. (NLP4PI '26) — **Strong** | Compression depth slider (0–60%), dim contrast level, hover-to-unfade paragraph, keyboard toggle (`S`). | Memory open-to-read conversion rate (how often opened memories get read instead of bounced in <30s). |
| 5 | `adaptive-ai-presenter` — **Adaptive AI Response Restructurer** | Working-memory overload from verbose LLM discussion replies | Presentation-layer wrapper on Psychiatrist responses: renders replies as scannable **TL;DR + collapsible bulleted blocks + bolded anchor terms**, with a persistent **Adapted / Original** 1-click toggle and optional chunk-by-chunk reveal. | Adapt AI (C&C '26); Rahman et al. (NLP4PI '26) — **Moderate–Strong** | Default view (Adapted vs. Original), max bullets before fold, auto-highlight key terms, progressive reveal toggle. | Follow-up engagement depth (turns per Psychiatrist thread) + % of AI replies fully read vs. abandoned. |
| 6 | `complexity-gated-scaffold` — **Complexity-Gated Summary & Jargon Glossary** | Cognitive overload on dense technical/academic articles without dumbing down simple ones | Estimates article complexity (lexical density / Flesch-Kincaid / domain jargon). Auto-offers structured summary cards only on **high-complexity** items (hiding them by default on simple posts), plus click/hover inline plain-language definitions for undefined jargon. | Rahman et al. (NLP4PI '26) — **Strong** | Complexity threshold slider, summary style (Structured Bullets vs. Extractive Key Sentences), inline glossary trigger (hover vs. click). | Self-rated comprehension confidence (1–5) on technical vs. casual memories; glossary lookup count. |
| 7 | `ephemeral-shelf-triage` — **Ephemeral Shelf & Deferred Triage** | Decision fatigue, premature-categorization friction, read-it-later hoarding guilt | Splits inbox into a zero-friction **Ephemeral Shelf** (auto-expiring/soft-archiving after N days unless promoted—no folders/tags required on save) and **Emergent Topic/Task Clusters** (lightweight AI-suggested labels applied *after* reading). Includes a 3-item Daily Pick cap to prevent archive overwhelm. | Chang et al. (CHI '21); Gstell (CHI '26) — **Strong** | Shelf TTL (7 / 14 / 30 days), expiry action (soft-archive vs. review prompt), Daily Pick cap (1–5 items), auto-label suggestion toggle. | Capture-to-triage time, inbox backlog growth rate, and weekly "archive anxiety" self-rating (1–5). |
| 8 | `temporal-landmark-bar` — **Spatial Temporal Landmarks & RSD-Safe Progress** | Time blindness, hyperfocus traps, and Rejection Sensitive Dysphoria (shame from red overdue badges/streaks) | Replaces numeric countdown timers, red unread counters, and streak counters with a **spatial section-landmark minimap** showing discrete heading nodes and **distance traveled** (never time left or unread debt). Optional gentle breakpoint nudges only at section boundaries. | Navneet et al. (arXiv '26, AttentionGuard); Zhu et al. (CHI '26) — **Moderate** | Show landmark rail (left/right/top), hide all unread counts & overdue badges (RSD-safe mode), breakpoint nudge interval (off / every N sections / soft ambient tint shift). | Session completion rate + subjective stress/guilt rating (1–5) when opening TRAUMA after a multi-day break. |
| 9 | `rsvp-micro-reader` — **Rewindable RSVP Micro-Reader** | Saccadic eye-movement interference during dense paragraphs | Opt-in modal/inline strip for any selected paragraph or section streaming words centered at an optimal recognition point (ORP), with **spacebar pause, sentence-back rewind, punctuation pause lengthening, and visual progress bar**. | Moussaoui et al. (JINS '25) — **Moderate** *(strong lab gain for ADHD, usability trade-offs in pilots)* | WPM (180–500), punctuation pause multiplier (1.5x–2.5x), chunk size (1–2 words), ORP highlight color. | Comprehension check / recall accuracy + reading completion on dense 500-word passages vs. normal scrolling. |
| 10 | `bionic-typography-lab` — **Experimental Typography & Bionic Sandbox** | Individual typographic variance (speed vs. comprehension trade-off) | Exposes font-family presets (Sans / Serif / Mono / Slab), line-height, measure (55–75ch), letter-spacing, plus an explicitly labeled **Experimental: Bionic Prefix Bold** toggle with an inline note explaining current null/mixed lab evidence for personal A/B testing. | Llana et al. (CHI EA '26); Snell (Acta Psych. '24); Možina et al. (SAGE Open '25) — **Strong for typography; Null/Negative for Bionic** | Font family, font size (14–22px), line-height (1.4–2.0), max-width (`ch`), bionic fixation ratio (off / 30% / 50%). | Personal A/B reading speed (wpm) and perceived comfort (1–5) across 3 memories per setting. |

Future candidate once AI workflows mature: `gentle-copilot-starter` — a
low-pressure, non-judgmental AI check-in prompt on memory open (e.g., "2-minute
skim or deep read?") grounded in Chen et al. (`arXiv:2603.17258`) and Zhu et al.
(CHI '26) to lower task-initiation paralysis.

## 3. Recommended Initial 4 Core Starter Plugins (PoC)

Build these four first. Together they carry the strongest empirical backing,
cover the four primary ADHD bottlenecks in a read-it-later + AI app, and
validate four distinct plugin-architecture extension points in SolidStart:

1. **`reading-ruler` (Digital Reading Ruler & Focus Mask)**
   - **Why first:** Strongest direct HCI evidence (CHI '23, CHI EA '26), zero
     LLM latency/cost, and immediate tactile contrast when toggled on/off.
   - **Architecture hook validated:** Reader viewport **overlay +
     keyboard/pointer listener + per-plugin settings schema**.
2. **`resumption-beacon` (Context-Switch Resumption Beacon)**
   - **Why first:** Directly targets ADHD's primary failure mode in long-form
     reading (distraction, tab switch, lost place, abandonment). Grounded in
     CHI '15 EyeBookmark.
   - **Architecture hook validated:** **Scroll/IntersectionObserver state
     persistence + tab-visibility lifecycle hooks** (`visibilitychange`) +
     transient DOM annotation.
3. **`adaptive-ai-presenter` (Adaptive AI Response Restructurer)**
   - **Why first:** Psychiatrist is TRAUMA's AI differentiator; verbose raw LLM
     walls of text defeat an ADHD-first UI. Grounded in C&C '26 (Adapt AI) and
     NLP4PI '26.
   - **Architecture hook validated:** **AI response presentation pipeline /
     renderer transform** with stateful `Adapted / Original` view switching.
4. **`ephemeral-shelf-triage` (Ephemeral Shelf & Deferred Triage)**
   - **Why first:** Solves the upstream bottleneck before reading starts:
     bookmark hoarding, premature-folder friction, and unread-list shame
     (CHI '21, CHI '26 Gstell).
   - **Architecture hook validated:** **List/inbox view & item-lifecycle hooks**
     (TTL/soft-archive rules, view filters, RSD-safe badge suppression).

## 4. Suggested Plugin Contract and Self-Experiment Harness

To make toggling genuinely useful for lived-experience comparison (Spiel et al.,
CHI '22):

- Each plugin registers
  `{ id, name, surface: 'reader' | 'ai-pane' | 'inbox' | 'chrome', enabled, settingsSchema, hooks }`.
- Optional **Experiment Log** toggle (off by default, RSD-safe—no scores or
  streaks): after closing a memory, optionally record a 1-click 3-state pulse
  (`Helped` / `Neutral` / `Distracting`) tagged with the active plugin set so
  the user can empirically discover their personal stack.
