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
