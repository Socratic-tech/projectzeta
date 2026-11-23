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
- `backend/` + `tools/build-backend.js`, `tools/test-backend.js`, `loader-code.html` — self-updating backend (see below)
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
- entry.html: `SKILL_RUBRICS` maps each existing skill key to the designer's rubric row(s) (display-only popup opened by tapping the skill name). Mapping: hygiene/dress→Appearance, Initiates→Task Initiation, logical order→Logical Order, quality→Quality Work, work rate→Work Rate, materials→Prepared, "Asks for help"→Resourcefulness, social interactions→Respect + Conversation Skills, communication→Expressive + Receptive, constructive criticism→Constructive Feedback, plus the same-named ones.
- entry.html UX: compact scoring key (top rubric row), 4 collapsible skill groups (`SKILL_GROUPS`, display only) that auto-close when complete, selected-level label, aria labels, sticky progress + submit bar (left gutter on phones for the accessibility button).
- report.html: two tabs, **Original rubric** / **New rubric**, split by entry `date` at `RUBRIC_CUTOFF = "2026-11-23"` (undated entries → Original). No blended view (only ~6 students span the change). Scale strip and "Report period" line follow the tab. No backend/tagging needed.
- demo data (report.html `buildDemoData`, demo-backend.js) is dated around the cutoff so both tabs show data; demo DB key is `demo_db_v4`.

## Self-updating backend (prototype on `demo`, not live)
- `backend/Code.gs` is now the source of truth for the Apps Script backend (3.1.0, copied from the user's paste). `tools/build-backend.js` generates `backend/bundle.js`, `backend/version.json` (version, notes, SHA-256) and `backend/Loader.gs`, plus `loader-code.html`. **Never hand-edit generated files**; edit `Code.gs` + `backend/notes.json`, bump `VT_RELEASE`, run `node tools/build-backend.js`, commit all together.
- A school pastes `Loader.gs` once (`loader-code.html`), runs `vtbInstallNow`, redeploys once. After that the Admin page (`updateStatus` / `installUpdate` / `undoUpdate`, handled in the loader, admin code required) offers **Update now**, **Undo last update**, **Remind me**. Also in the Sheet menu. Updates are never automatic and install only if the SHA-256 matches, it compiles, exposes the required functions and passes a liveness check on that Sheet. Previous version kept in Script Properties (`VTB_*`).
- Data safety: undo reverts code only, not sheet data. Keep releases additive; do not bump `VT_SCHEMA_VERSION` casually (it rotates the entry token).
- Schools without the loader still get the old manual notice from `release.json` (admin.html falls back when `updateStatus` returns Unknown action).
- Test offline with `node tools/test-backend.js` (fake Apps Script; 33 checks). Not yet tested in a real Sheet or in the browser Admin page.
- Security: the loader runs code downloaded from the site inside a Sheet holding student records. `main` is PR-gated; keep it that way, and show the hash/notes to the program designer before releasing.

## Open items
- Set `RUBRIC_CUTOFF` to the real go-live date of the new entry form if it is later than 2026-11-23 (entries dated in between were scored on the old form).
- `Code.gs` 3.1.0 (pasted by the user, 2026-11-23) was reviewed: it tolerates the current payload and layout routes match `report-builder.js`; no change required. Still open: (a) `getEntries` returns sheet dates as Date objects and `report.html` `dateKey` uses the UTC day, so a spreadsheet time zone ahead of UTC would shift entries a day across `RUBRIC_CUTOFF`. Consider returning `YYYY-MM-DD` text via `Utilities.formatDate`. (b) Confirm the pasted copy matches the Google Doc linked from `release.json`. (c) `deleteStudent` hard-deletes and orphans entries; prefer deactivating.
- Not yet tested in a real browser at phone width (collapse/auto-scroll, dark theme, sticky bar vs accessibility button). The Browser pane renders `file://` pages as static snapshots (scripts don't run); a local `http.server` was blocked by the auto-mode classifier, so verify on the preview site or via Node stubs.
