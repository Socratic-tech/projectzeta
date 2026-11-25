# Vocational Tracker (projectzeta)

Static HTML/JS app (no build step) where teachers score students on 16 job skills (0–4 prompting scale) at job sites. Backend is a Google Sheet + Apps Script (`Code.gs` lives in a Google Doc linked from `release.json`, not in this repo).

## Rules
- **`main` is LIVE** — GitHub Pages serves it to real schools at socratic-tech.github.io/projectzeta/. Never push to, merge into, or open/merge PRs to `main` unless the user explicitly says so. (A hook blocks pushes to main; GitHub requires a PR.)
- Work on the `demo` branch (or a branch off it). Push only to `origin demo`.
- Show changes to the end user (a teacher, non-GitHub) via the preview site: run `tools/deploy-preview.sh` → socratic-tech.github.io/projectzeta-preview/ (~1 min to rebuild). It flips `VT_ENV` to "PREVIEW" in the published copy only; keep `const VT_ENV = "";` in every page.
- Test data only. No real student names/records in code, commits, or the preview backend (FERPA).

## File map (files are large — read only the section you need, grep first)
- `index.html` — home/dashboard, connection status
- `entry.html` — daily score entry form (offline draft + retry queue)
- `report.html` + `report-builder.js` — student report, charts, customizable layouts, demo mode
- `admin.html` — roster, job sites, codes/QR, update notices (reads `release.json`)
- `setup.html`, `setup-tour.html`, `sidebar-code.html` — school setup / upgrade guides
- `faq.html` — help page
- `tracker-switcher.js` — switch between multiple school trackers
- All browser storage keys go through `vtKey()`; keep it that way.

## Workflow
1. Edit on `demo`, commit. 2. `tools/deploy-preview.sh`. 3. Teacher gives feedback. 4. Going live = user opens/merges a PR demo → main on GitHub.

## Data safety (do not break existing sheet data)
- Scores are saved as `{ "<skill name>": 0-4, "task:<task name>": 0-4 }`. The 16 skill names in `SKILLS_LIST` (entry.html) / `CORE_SKILLS` (report.html) / `SKILLS` (demo-backend.js) are the stored keys. **Never rename or reorder-by-rename them.** Anything user-facing (new headings, groups, labels) must be display-only on top of those keys.
- Job tasks: `null` = N/A and is not saved. Behavioral skills: `null` = not yet scored and now blocks submit (no silent default of 2).

## New rubric (Nov 2026 redesign by the program designer)
- Levels: 0 Incomplete, 1 Direct Support, 2 Minimal Support, 3 Independent, 4 Advanced. Original names were Not at All, Direct Prompting, Indirect Prompting, Independent, Helping / Teaching (kept only in report.html `SCALE_ORIGINAL`).
- entry.html: `SKILL_RUBRICS` (now in rubric-data.js) maps each existing skill key to the designer's rubric row(s) (display-only popup opened by tapping the skill name). Mapping: hygiene/dress→Appearance, Initiates→Task Initiation, logical order→Logical Order, quality→Quality Work, work rate→Work Rate, materials→Prepared, "Asks for help"→Resourcefulness, social interactions→Respect + Conversation Skills, communication→Expressive + Receptive, constructive criticism→Constructive Feedback, plus the same-named ones.
- entry.html UX: compact scoring key (top rubric row), 4 collapsible skill groups (`SKILL_GROUPS`, display only) that auto-close when complete, selected-level label, aria labels, sticky progress + submit bar (left gutter on phones for the accessibility button).
- report.html: two tabs, **Original rubric** / **New rubric**, split by entry `date` at `RUBRIC_CUTOFF = "2026-11-23"` (undated entries → Original). No blended view (only ~6 students span the change). Scale strip and "Report period" line follow the tab. No backend/tagging needed.
- Skill names people see (entry rows, report tiles/chart/lists) are the designer's rubric names via `vtSkillTitle()` in rubric-data.js (Appearance, Task Initiation, ...). Stored keys never change; the Original report tab shows the old names.
- `rubric-data.js` is the single source for the new rubric's display data (`VT_SKILL_GROUPS`, `VT_SKILL_RUBRICS`, `VT_LEVELS`); both entry.html and report.html read it, so edit there once. Report behavioral tiles/chart are ordered and headed by the four groups, the New-tab scale strip carries the one-line level descriptions, and a collapsible skill-by-skill guide shows the designer's rows in the same groups. Score band labels (`SCORE_BANDS.label`) follow the active rubric tab.
- Two-rubric skills (social interactions → Respect + Conversation Skills; communication → Expressive + Receptive) are scored once per rubric in entry.html (Karen's feedback, 2026-11-24). Each rubric score is saved as an extra `"part:<skill>::<rubric title>"` key next to the unchanged skill key, which holds the LOWER of the two (so the Sheet/Code.gs/old reports are unaffected). On the New rubric report tab the two skills are shown as two rows (tiles, chart, strengths/needs) from the `part:` keys; entries without them (and the Original tab) show the combined skill. Elsewhere report code ignores `part:` keys in averages/lists. Code.gs stores scores_json blindly, so no backend change.
- demo data (report.html `buildDemoData`, demo-backend.js) is dated around the cutoff so both tabs show data; demo DB key is `demo_db_v5`.

## Decisions
- **No self-updating backend / remote-code loader.** A prototype (commit a8e4553, reverted) let admins click "Update now" to install Code.gs from the website. Rejected 2026-11-23: it would let whoever controls the site or repo change code in every school's Sheet (student data). Schools keep updating by pasting Code.gs themselves. Do not reintroduce without the user asking.
- The Google Doc linked from `release.json` was still release 3.0.1 on 2026-11-23, behind the 3.1.0 the user pasted. Update the Doc so setup pages hand out current code.

## Open items
- Set `RUBRIC_CUTOFF` to the real go-live date of the new entry form if it is later than 2026-11-23 (entries dated in between were scored on the old form).
- `Code.gs` 3.1.0 (pasted by the user, 2026-11-23) was reviewed: it tolerates the current payload and layout routes match `report-builder.js`; no change required. Still open: (a) `getEntries` returns sheet dates as Date objects and `report.html` `dateKey` uses the UTC day, so a spreadsheet time zone ahead of UTC would shift entries a day across `RUBRIC_CUTOFF`. Consider returning `YYYY-MM-DD` text via `Utilities.formatDate`. (b) Confirm the pasted copy matches the Google Doc linked from `release.json`. (c) `deleteStudent` hard-deletes and orphans entries; prefer deactivating.
- Not yet tested in a real browser at phone width (collapse/auto-scroll, dark theme, sticky bar vs accessibility button). The Browser pane renders `file://` pages as static snapshots (scripts don't run); a local `http.server` was blocked by the auto-mode classifier, so verify on the preview site or via Node stubs.
