/************************************************************
 * REPORT BUILDER
 *
 * The student report is a list of blocks. A "layout" says which
 * blocks appear, in what order, and how each is set up. Layouts are
 * shared school-wide through the backend (Code.gs 3.1.0+):
 *   - anyone with Reports access can use them and customize for the
 *     current session;
 *   - only administrators can save, delete, or set the default.
 *
 * Layouts never contain student data. Every layout (from the backend
 * or anywhere else) goes through sanitizeLayout() before use, and all
 * text is rendered as text, never HTML.
 *
 * Depends on report.html globals: BLOCK_FILLERS, CORE_SKILLS,
 * average, scoreValues, parseDate, formatDate, bandFor, round2,
 * scorePill, wrapLabel, escapeHTML, fetchJson, reportCodeValue,
 * viewerRole, DEMO_MODE, customCharts, printBarHeight, barChartHeight.
 ************************************************************/
const ReportBuilder = (function () {
    "use strict";

    /* ---------------- Block catalog ---------------- */

    const BUILTIN = {
        header:     { label: "Report header",                desc: "Student name, report period, job site and program." },
        summary:    { label: "Summary tiles",                desc: "Average score, number of evaluations, percent scored 3 or 4, most recent date." },
        scale:      { label: "Scoring scale key",            desc: "The 0–4 scale and what each color means." },
        strengths:  { label: "Relative strengths and needs", desc: "Top and bottom behavioral skills and job tasks." },
        behavior:   { label: "Behavioral skills",            desc: "Color-coded chart and tiles for every behavioral skill." },
        tasks:      { label: "Job tasks",                    desc: "Color-coded chart and tiles for every job task." },
        sites:      { label: "Job site averages",            desc: "Average score at each job site." },
        progress:   { label: "Progress over time",           desc: "Average score at each evaluation." },
        history:    { label: "Evaluation history",           desc: "Sortable table of every evaluation." },
        signatures: { label: "Signature lines",              desc: "Student and employer signature and date lines." }
    };

    const CUSTOM = {
        chart:     { label: "Chart",           desc: "Chart any score, broken down by date, month, job site, evaluator, skill or task." },
        table:     { label: "Table",           desc: "Table of averages, counts, highs and lows, first and latest scores, and change." },
        text:      { label: "Text",            desc: "Your own text, such as goals, narrative or next steps." },
        notes:     { label: "Evaluator notes", desc: "Every evaluator comment in the report period." },
        pageBreak: { label: "Page break",      desc: "Start a new page here when printing." }
    };

    const DIMENSIONS = {
        date:      { label: "Each evaluation", row: "Evaluation date" },
        month:     { label: "Month",           row: "Month" },
        site:      { label: "Job site",        row: "Job site" },
        evaluator: { label: "Evaluator",       row: "Evaluator" },
        skill:     { label: "Behavioral skill", row: "Behavioral skill" },
        task:      { label: "Job task",        row: "Job task" }
    };

    const COLUMNS = {
        avg:    "Average",
        count:  "Scores",
        min:    "Lowest",
        max:    "Highest",
        first:  "First",
        latest: "Latest",
        change: "Change",
        pct3:   "Scored 3 or 4"
    };

    const STYLES = { bar: "Vertical bars", hbar: "Horizontal bars", line: "Line" };

    const MAX_BLOCKS = 60;
    const MAX_TITLE = 80;
    const MAX_TEXT = 4000;

    const STANDARD = {
        version: 1,
        blocks: [
            { type: "header" }, { type: "summary" }, { type: "scale" }, { type: "strengths" },
            { type: "pageBreak" },
            { type: "behavior" },
            { type: "pageBreak" },
            { type: "tasks" }, { type: "sites" },
            { type: "pageBreak" },
            { type: "progress" }, { type: "history" }, { type: "signatures" }
        ]
    };

    /* ---------------- State ---------------- */

    const state = {
        layouts: [],        // shared layouts [{id,name,layout,updatedBy,updatedAt,isDefault}]
        supported: false,   // backend has the layout routes
        canEdit: false,     // this person may save shared layouts
        demo: false,
        currentId: "",      // "" = built-in Standard report
        working: null,      // layout on screen (sanitized)
        dirty: false,
        editing: false,
        notice: "",
        ctx: null,
        dragId: null
    };

    /* ---------------- Utilities ---------------- */

    function uid() {
        return "b" + Math.random().toString(36).slice(2, 9);
    }

    function clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function str(v, max) {
        return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max);
    }

    function el(tag, attrs, text) {
        const node = document.createElement(tag);
        Object.entries(attrs || {}).forEach(([k, v]) => {
            if (k === "class") node.className = v;
            else if (k === "style") node.style.cssText = v;
            else node.setAttribute(k, v);
        });
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function icon(name, cls) {
        return el("span", { class: "material-icons " + (cls || ""), "aria-hidden": "true" }, name);
    }

    function validMeasure(m) {
        m = str(m, 200);
        if (m === "overall" || m === "behavior" || m === "tasks") return m;
        if (/^skill:.+/.test(m) || /^task:.+/.test(m)) return m;
        return "overall";
    }

    function measureLabel(m) {
        if (m === "overall") return "Overall average";
        if (m === "behavior") return "Behavioral skills average";
        if (m === "tasks") return "Job tasks average";
        if (m.startsWith("skill:")) return m.slice(6);
        if (m.startsWith("task:")) return m.slice(5);
        return m;
    }

    function itemDimension(dim) {
        return dim === "skill" || dim === "task";
    }

    /* ---------------- Layout validation ---------------- */

    function sanitizeBlock(raw, seenBuiltins) {
        if (!raw || typeof raw !== "object") return null;
        const type = String(raw.type || "");
        if (!BUILTIN[type] && !CUSTOM[type]) return null;
        if (BUILTIN[type]) {
            if (seenBuiltins.has(type)) return null;     // built-ins appear at most once
            seenBuiltins.add(type);
        }

        const o = (raw.options && typeof raw.options === "object") ? raw.options : {};
        const block = {
            id: /^[a-z0-9]{2,12}$/i.test(raw.id || "") ? raw.id : uid(),
            type,
            hidden: raw.hidden === true,
            title: str(raw.title, MAX_TITLE).trim(),
            options: {}
        };

        if (type === "behavior" || type === "tasks") {
            block.options.showChart = o.showChart !== false;
            block.options.showTiles = o.showTiles !== false;
        } else if (type === "chart") {
            block.options.groupBy = DIMENSIONS[o.groupBy] ? o.groupBy : "month";
            block.options.measure = validMeasure(o.measure);
            block.options.style = STYLES[o.style] ? o.style : "bar";
        } else if (type === "table") {
            block.options.rows = DIMENSIONS[o.rows] ? o.rows : "site";
            block.options.measure = validMeasure(o.measure);
            const cols = Array.isArray(o.columns) ? o.columns.filter(c => COLUMNS[c]) : [];
            block.options.columns = cols.length ? [...new Set(cols)] : ["avg", "count", "latest", "change"];
        } else if (type === "text") {
            block.options.text = str(o.text, MAX_TEXT);
        } else if (type === "notes") {
            block.options.order = o.order === "oldest" ? "oldest" : "newest";
        }
        return block;
    }

    function sanitizeLayout(raw) {
        const blocks = (raw && Array.isArray(raw.blocks)) ? raw.blocks.slice(0, MAX_BLOCKS) : [];
        const seen = new Set();
        const clean = blocks.map(b => sanitizeBlock(b, seen)).filter(Boolean);
        return { version: 1, blocks: clean.length ? clean : sanitizeLayout(STANDARD).blocks };
    }

    function exportLayout(layout) {
        // What gets saved: no ids that matter, no student data.
        return {
            version: 1,
            blocks: layout.blocks.map(b => {
                const out = { id: b.id, type: b.type };
                if (b.hidden) out.hidden = true;
                if (b.title) out.title = b.title;
                if (Object.keys(b.options).length) out.options = b.options;
                return out;
            })
        };
    }

    /* ---------------- Data for custom blocks ---------------- */

    function numbers(list) {
        return list.map(Number).filter(n => Number.isFinite(n));
    }

    function measureValues(entry, measure) {
        const s = entry.scores || {};
        const pairs = Object.entries(s);
        if (measure === "overall") return numbers(pairs.map(p => p[1]));
        if (measure === "behavior") return numbers(pairs.filter(p => !p[0].startsWith("task:")).map(p => p[1]));
        if (measure === "tasks") return numbers(pairs.filter(p => p[0].startsWith("task:")).map(p => p[1]));
        if (measure.startsWith("skill:")) return numbers([s[measure.slice(6)]]);
        if (measure.startsWith("task:")) return numbers([s[measure]]);
        return [];
    }

    function entryTime(entry) {
        const d = parseDate(entry.date);
        return d ? d.getTime() : 0;
    }

    function monthKey(entry) {
        const d = parseDate(entry.date);
        if (!d) return null;
        return {
            key: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"),
            label: d.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
            sort: new Date(d.getFullYear(), d.getMonth(), 1).getTime()
        };
    }

    /** Groups → [{label, sort, points:[{t, v}]}] in display order. */
    function groupData(entries, dim, measure) {
        const groups = new Map();
        const add = (key, label, sort, t, values) => {
            if (!values.length) return;
            if (!groups.has(key)) groups.set(key, { label, sort, points: [] });
            values.forEach(v => groups.get(key).points.push({ t, v }));
        };

        entries.forEach(entry => {
            const t = entryTime(entry);

            if (dim === "skill" || dim === "task") {
                Object.entries(entry.scores || {}).forEach(([k, v]) => {
                    const isTask = k.startsWith("task:");
                    if ((dim === "task") !== isTask) return;
                    const name = isTask ? k.slice(5) : k;
                    const order = isTask ? name.toLowerCase() : (CORE_SKILLS.indexOf(name) + 1 || 999);
                    add(k, name, order, t, numbers([v]));
                });
                return;
            }

            const values = measureValues(entry, measure);
            if (dim === "date") {
                add(String(entry.entry_id || t) + ":" + t, formatDate(entry.date), t, t, values);
            } else if (dim === "month") {
                const m = monthKey(entry);
                if (m) add(m.key, m.label, m.sort, t, values);
            } else if (dim === "site") {
                const site = String(entry.job_site || "").trim() || "No site recorded";
                add(site, site, site.toLowerCase(), t, values);
            } else if (dim === "evaluator") {
                const ev = String(entry.evaluator || "").trim() || "Not recorded";
                add(ev, ev, ev.toLowerCase(), t, values);
            }
        });

        return [...groups.values()].sort((a, b) =>
            typeof a.sort === "number" && typeof b.sort === "number"
                ? a.sort - b.sort
                : String(a.sort).localeCompare(String(b.sort), undefined, { numeric: true })
        );
    }

    function stats(points) {
        const values = points.map(p => p.v);
        const times = [...new Set(points.map(p => p.t))].sort((a, b) => a - b);
        const at = t => average(points.filter(p => p.t === t).map(p => p.v));
        const first = times.length ? at(times[0]) : null;
        const latest = times.length ? at(times[times.length - 1]) : null;
        return {
            avg: average(values),
            count: values.length,
            min: values.length ? Math.min(...values) : null,
            max: values.length ? Math.max(...values) : null,
            first,
            latest,
            change: times.length > 1 ? latest - first : null,
            pct3: values.length ? Math.round(values.filter(v => v >= 3).length / values.length * 100) : null
        };
    }

    /** Skills and tasks available to pick from (catalog + anything scored). */
    function availableItems() {
        const skills = new Set(CORE_SKILLS);
        const tasks = new Set();
        (typeof allTasks !== "undefined" ? allTasks : []).forEach(t => t && t.task_name && tasks.add(String(t.task_name)));
        (typeof allEntries !== "undefined" ? allEntries : []).forEach(e => Object.keys(e.scores || {}).forEach(k => {
            if (k.startsWith("task:")) tasks.add(k.slice(5)); else skills.add(k);
        }));
        return {
            skills: [...skills],
            tasks: [...tasks].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }))
        };
    }

    /* ---------------- Rendering ---------------- */

    function defaultTitle(block) {
        const o = block.options;
        if (block.type === "chart") {
            if (itemDimension(o.groupBy)) {
                return (o.groupBy === "skill" ? "Behavioral skills" : "Job tasks") + " (average)";
            }
            return measureLabel(o.measure) + " by " + DIMENSIONS[o.groupBy].label.toLowerCase();
        }
        if (block.type === "table") {
            if (itemDimension(o.rows)) return (o.rows === "skill" ? "Behavioral skills" : "Job tasks") + " table";
            return measureLabel(o.measure) + " by " + DIMENSIONS[o.rows].label.toLowerCase();
        }
        if (block.type === "notes") return "Evaluator notes";
        if (block.type === "text") return "";
        return (BUILTIN[block.type] || CUSTOM[block.type] || {}).label || "";
    }

    function card(extraClass) {
        return el("section", { class: "print-card bg-white rounded-2xl shadow-sm border border-slate-200 p-5 " + (extraClass || "") });
    }

    function heading(text, iconName, iconColor) {
        const h = el("h3", { class: "font-bold text-slate-900 mb-3 flex items-center gap-2" });
        h.appendChild(icon(iconName, iconColor));
        h.appendChild(el("span", {}, text));
        return h;
    }

    function emptyNote(text) {
        return el("p", { class: "text-slate-500 text-sm" }, text);
    }

    function renderChartBlock(block, ctx) {
        const o = block.options;
        const section = card();
        section.appendChild(heading(block.title || defaultTitle(block), "insert_chart", "text-blue-700"));

        const groups = groupData(ctx.entries, o.groupBy, o.measure)
            .map(g => ({ label: g.label, avg: average(g.points.map(p => p.v)), n: g.points.length }))
            .filter(g => g.avg !== null);

        if (!groups.length) {
            section.appendChild(emptyNote("No scores for " + measureLabel(o.measure).toLowerCase() + " in this selection."));
            return { node: section };
        }

        const horizontal = o.style === "hbar";
        const screenH = horizontal ? barChartHeight(groups.length) : 300;
        const printH = horizontal ? printBarHeight(groups.length) : 240;
        const wrap = el("div", { class: "relative", style: "height:" + screenH + "px" });
        const canvas = el("canvas", { role: "img", "aria-label": block.title || defaultTitle(block) });
        wrap.appendChild(canvas);
        section.appendChild(wrap);

        const after = () => {
            const values = groups.map(g => round2(g.avg));
            const colors = groups.map(g => bandFor(g.avg).fill);
            const isLine = o.style === "line";
            const chart = new Chart(canvas, {
                type: isLine ? "line" : "bar",
                data: {
                    labels: groups.map(g => horizontal ? wrapLabel(g.label) : g.label),
                    datasets: [{
                        label: "Average",
                        data: values,
                        backgroundColor: isLine ? undefined : colors,
                        borderColor: isLine ? "#334155" : colors,
                        borderWidth: isLine ? 3 : 1,
                        tension: 0.25,
                        pointRadius: isLine ? 5 : undefined,
                        pointBackgroundColor: isLine ? colors : undefined,
                        pointBorderColor: isLine ? colors : undefined
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    indexAxis: horizontal ? "y" : "x",
                    scales: horizontal
                        ? { x: { min: 0, max: 4, ticks: { stepSize: 1 } }, y: { ticks: { autoSkip: false, font: { size: 11 } } } }
                        : { y: { min: 0, max: 4, ticks: { stepSize: 1 } } },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                title: items => groups[items[0].dataIndex].label,
                                label: item => {
                                    const g = groups[item.dataIndex];
                                    return g.avg.toFixed(2) + " / 4 (" + bandFor(g.avg).label + "), " + g.n + " score" + (g.n === 1 ? "" : "s");
                                }
                            }
                        }
                    }
                }
            });
            chart.$vtScreenHeight = screenH;
            chart.$vtPrintHeight = printH;
            customCharts.push(chart);
        };
        return { node: section, after };
    }

    function fmt(n, signed) {
        if (n === null || n === undefined || !Number.isFinite(n)) return "—";
        const s = n.toFixed(2);
        return signed && n > 0 ? "+" + s : s;
    }

    function renderTableBlock(block, ctx) {
        const o = block.options;
        const section = card("overflow-hidden");
        section.appendChild(heading(block.title || defaultTitle(block), "table_chart", "text-blue-700"));

        const groups = groupData(ctx.entries, o.rows, o.measure);
        if (!groups.length) {
            section.appendChild(emptyNote("No scores for " + measureLabel(o.measure).toLowerCase() + " in this selection."));
            return { node: section };
        }

        const scroll = el("div", { class: "overflow-x-auto" });
        const table = el("table", { class: "w-full text-sm" });
        const thead = el("thead", { class: "bg-slate-50 text-slate-600 text-xs uppercase" });
        const hr = el("tr");
        hr.appendChild(el("th", { class: "px-3 py-2 text-left" }, DIMENSIONS[o.rows].row));
        o.columns.forEach(c => hr.appendChild(el("th", { class: "px-3 py-2 text-left" }, COLUMNS[c])));
        thead.appendChild(hr);
        table.appendChild(thead);

        const tbody = el("tbody");
        groups.forEach(g => {
            const st = stats(g.points);
            const tr = el("tr", { class: "border-t border-slate-200" });
            tr.appendChild(el("td", { class: "px-3 py-2 font-semibold text-slate-800" }, g.label));
            o.columns.forEach(c => {
                const td = el("td", { class: "px-3 py-2" });
                if (c === "avg" || c === "first" || c === "latest") {
                    td.innerHTML = st[c] === null ? "—" : scorePill(st[c]);   // scorePill builds from numbers only
                } else if (c === "min" || c === "max") {
                    td.textContent = st[c] === null ? "—" : String(st[c]);
                } else if (c === "change") {
                    td.textContent = fmt(st.change, true);
                    if (st.change > 0) td.style.color = "#166534";
                    if (st.change < 0) td.style.color = "#991b1b";
                    td.style.fontWeight = "700";
                } else if (c === "pct3") {
                    td.textContent = st.pct3 === null ? "—" : st.pct3 + "%";
                } else {
                    td.textContent = String(st[c]);
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        scroll.appendChild(table);
        section.appendChild(scroll);
        return { node: section };
    }

    function renderTextBlock(block) {
        const section = card();
        if (block.title) section.appendChild(heading(block.title, "notes", "text-slate-600"));
        const text = block.options.text || "";
        if (text) {
            section.appendChild(el("div", { class: "text-slate-800 leading-relaxed", style: "white-space:pre-wrap" }, text));
        } else {
            section.appendChild(emptyNote("Empty text block. Use Customize, then the gear on this block, to add text."));
            section.classList.add("rb-empty-text");
        }
        return { node: section };
    }

    function renderNotesBlock(block, ctx) {
        const section = card();
        section.appendChild(heading(block.title || defaultTitle(block), "comment", "text-slate-600"));
        let list = ctx.entries.filter(e => String(e.comments || "").trim());
        list = list.slice().sort((a, b) => entryTime(b) - entryTime(a));
        if (block.options.order === "oldest") list.reverse();

        if (!list.length) {
            section.appendChild(emptyNote("No evaluator notes in this selection."));
            return { node: section };
        }
        const ul = el("ul", { class: "divide-y divide-slate-200" });
        list.forEach(e => {
            const li = el("li", { class: "py-2" });
            const meta = [formatDate(e.date), e.job_site, e.evaluator].filter(Boolean).join("  |  ");
            li.appendChild(el("div", { class: "text-xs font-bold text-slate-500" }, meta));
            li.appendChild(el("div", { class: "text-slate-800", style: "white-space:pre-wrap" }, String(e.comments)));
            ul.appendChild(li);
        });
        section.appendChild(ul);
        return { node: section };
    }

    function renderBuiltin(block) {
        const tpl = document.getElementById("tpl-" + block.type);
        const frag = tpl.content.cloneNode(true);
        const node = frag.firstElementChild;
        if (block.title) {
            const t = node.querySelector("[data-title]");
            if (t) t.textContent = block.title;
        }
        if (block.type === "behavior" || block.type === "tasks") {
            if (block.options.showChart === false) node.querySelector('[data-part="chart"]').remove();
            if (block.options.showTiles === false) node.querySelector('[data-part="tiles"]').classList.add("hidden");
        }
        return { node, after: () => BLOCK_FILLERS[block.type](state.ctx, block) };
    }

    function renderBlock(block, ctx) {
        if (BUILTIN[block.type]) return renderBuiltin(block);
        if (block.type === "chart") return renderChartBlock(block, ctx);
        if (block.type === "table") return renderTableBlock(block, ctx);
        if (block.type === "text") return renderTextBlock(block);
        if (block.type === "notes") return renderNotesBlock(block, ctx);
        return null;
    }

    /* ---------------- Editor chrome ---------------- */

    function controlButton(iconName, label, onClick, opts) {
        const b = el("button", { type: "button", class: "rb-ctl", title: label, "aria-label": label });
        b.appendChild(icon(iconName, "text-base"));
        if (opts && opts.disabled) b.disabled = true;
        b.addEventListener("click", onClick);
        return b;
    }

    function blockLabel(block) {
        return (BUILTIN[block.type] || CUSTOM[block.type]).label;
    }

    function editorFrame(block, index, inner) {
        const frame = el("div", { class: "rb-frame no-print-chrome", "data-id": block.id });
        const bar = el("div", { class: "rb-bar no-print" });

        const handle = el("span", { class: "rb-handle", title: "Drag to move", draggable: "true", "aria-hidden": "true" });
        handle.appendChild(icon("drag_indicator"));
        handle.addEventListener("dragstart", ev => {
            state.dragId = block.id;
            ev.dataTransfer.effectAllowed = "move";
            ev.dataTransfer.setData("text/plain", block.id);
            frame.classList.add("rb-dragging");
        });
        handle.addEventListener("dragend", () => {
            state.dragId = null;
            frame.classList.remove("rb-dragging");
            document.querySelectorAll(".rb-drop-before,.rb-drop-after").forEach(n => n.classList.remove("rb-drop-before", "rb-drop-after"));
        });
        bar.appendChild(handle);

        const name = el("span", { class: "rb-name" }, blockLabel(block) + (block.hidden ? " (hidden)" : ""));
        bar.appendChild(name);

        const tools = el("span", { class: "rb-tools" });
        const last = state.working.blocks.length - 1;
        tools.appendChild(controlButton("arrow_upward", "Move up", () => move(index, -1), { disabled: index === 0 }));
        tools.appendChild(controlButton("arrow_downward", "Move down", () => move(index, 1), { disabled: index === last }));
        if (block.type !== "pageBreak") {
            if (block.type !== "header" && block.type !== "summary") {
                tools.appendChild(controlButton("settings", "Settings", () => openSettings(block)));
            }
            tools.appendChild(controlButton(block.hidden ? "visibility" : "visibility_off", block.hidden ? "Show" : "Hide", () => {
                block.hidden = !block.hidden; changed();
            }));
        }
        if (CUSTOM[block.type] && block.type !== "pageBreak") {
            tools.appendChild(controlButton("content_copy", "Duplicate", () => {
                const copy = clone(block); copy.id = uid();
                state.working.blocks.splice(index + 1, 0, copy); changed();
            }));
        }
        tools.appendChild(controlButton("delete", "Remove", () => {
            state.working.blocks.splice(index, 1); changed();
        }));
        bar.appendChild(tools);
        frame.appendChild(bar);

        frame.addEventListener("dragover", ev => {
            if (!state.dragId || state.dragId === block.id) return;
            ev.preventDefault();
            const r = frame.getBoundingClientRect();
            const before = ev.clientY < r.top + r.height / 2;
            frame.classList.toggle("rb-drop-before", before);
            frame.classList.toggle("rb-drop-after", !before);
        });
        frame.addEventListener("dragleave", () => frame.classList.remove("rb-drop-before", "rb-drop-after"));
        frame.addEventListener("drop", ev => {
            ev.preventDefault();
            if (!state.dragId || state.dragId === block.id) {
                frame.classList.remove("rb-drop-before", "rb-drop-after");
                return;   // dropped on itself: nothing to do
            }
            const before = frame.classList.contains("rb-drop-before");
            frame.classList.remove("rb-drop-before", "rb-drop-after");
            const from = state.working.blocks.findIndex(b => b.id === state.dragId);
            if (from < 0) return;
            const [moved] = state.working.blocks.splice(from, 1);
            let to = state.working.blocks.findIndex(b => b.id === block.id);
            if (!before) to += 1;
            state.working.blocks.splice(to, 0, moved);
            changed();
        });

        if (inner) frame.appendChild(inner);
        return frame;
    }

    function move(index, delta) {
        const blocks = state.working.blocks;
        const to = index + delta;
        if (to < 0 || to >= blocks.length) return;
        [blocks[index], blocks[to]] = [blocks[to], blocks[index]];
        changed(blocks[to].id);
    }

    function changed(focusId) {
        state.dirty = true;
        rerender(focusId);
    }

    function rerender(focusId) {
        if (typeof renderReport === "function") renderReport();
        if (focusId) {
            const f = document.querySelector('.rb-frame[data-id="' + focusId + '"] .rb-handle');
            if (f) f.closest(".rb-frame").scrollIntoView({ block: "nearest" });
        }
    }

    /* ---------------- Main render ---------------- */

    function render(ctx) {
        state.ctx = ctx;
        if (!state.working) state.working = sanitizeLayout(STANDARD);

        renderBar();

        const container = document.getElementById("reportBlocks");
        container.innerHTML = "";
        container.classList.toggle("rb-editing", state.editing);

        const afters = [];
        let breakNext = false;
        let renderedAny = false;

        state.working.blocks.forEach((block, index) => {
            if (block.type === "pageBreak") {
                if (state.editing) {
                    const line = el("div", { class: "rb-pagebreak no-print" });
                    line.appendChild(el("span", {}, "Page break"));
                    container.appendChild(editorFrame(block, index, line));
                }
                if (renderedAny) breakNext = true;
                return;
            }

            if (block.hidden && !state.editing) return;

            let result = null;
            if (!block.hidden) {
                try {
                    result = renderBlock(block, ctx);
                } catch (err) {
                    console.error("Block failed to render:", block.type, err);
                    const c = card();
                    c.appendChild(emptyNote("This block couldn't be shown."));
                    result = { node: c };
                }
            }

            let node = result ? result.node : null;
            if (block.hidden) {
                node = el("div", { class: "rb-hidden-note no-print" }, blockLabel(block) + " is hidden. It won't appear or print.");
            }

            const wrapper = state.editing ? editorFrame(block, index, node) : node;
            if (breakNext && !block.hidden) {
                wrapper.classList.add("print-break-before");
                breakNext = false;
            }
            container.appendChild(wrapper);
            if (!block.hidden) renderedAny = true;
            if (result && result.after) afters.push(result.after);
        });

        if (!state.working.blocks.some(b => !b.hidden && b.type !== "pageBreak")) {
            container.appendChild(emptyNote(state.editing
                ? "This layout has no visible blocks. Use Add block to start."
                : "This layout has no visible blocks."));
        }

        // Fill after everything is in the page (charts need real sizes).
        afters.forEach(fn => {
            try { fn(); } catch (err) { console.error("Block failed to fill:", err); }
        });
    }

    /* ---------------- Toolbar ---------------- */

    function currentName() {
        if (!state.currentId) return "Standard report";
        const l = state.layouts.find(x => x.id === state.currentId);
        return l ? l.name : "Standard report";
    }

    function renderBar() {
        const bar = document.getElementById("layoutBar");
        bar.innerHTML = "";
        const box = el("div", { class: "bg-white rounded-2xl shadow-sm border border-slate-200 p-3 flex flex-wrap items-center gap-2" });

        const lab = el("label", { for: "rbLayoutSelect", class: "text-sm font-bold text-slate-700" }, "Layout");
        const select = el("select", { id: "rbLayoutSelect", class: "p-2 border border-slate-300 rounded-lg bg-white text-sm font-semibold max-w-xs" });
        const std = el("option", { value: "" }, "Standard report" + (state.layouts.some(l => l.isDefault) ? "" : " (school default)"));
        select.appendChild(std);
        state.layouts.forEach(l => {
            const opt = el("option", { value: l.id }, l.name + (l.isDefault ? " (school default)" : ""));
            select.appendChild(opt);
        });
        select.value = state.currentId;
        select.addEventListener("change", () => {
            if (state.dirty && !confirm("Discard your unsaved changes to \"" + currentName() + "\"?")) {
                select.value = state.currentId;
                return;
            }
            selectLayout(select.value);
        });
        box.appendChild(lab);
        box.appendChild(select);

        if (state.dirty) box.appendChild(el("span", { class: "text-xs font-bold text-amber-700" }, "Unsaved changes"));

        const spacer = el("span", { class: "flex-1" });
        box.appendChild(spacer);

        const btn = (text, iconName, onClick, primary, extra) => {
            const b = el("button", {
                type: "button",
                class: (primary
                    ? "bg-blue-800 hover:bg-blue-900 text-white"
                    : "bg-white hover:bg-slate-50 text-slate-800 border border-slate-300") +
                    " font-bold px-3 py-2 rounded-lg text-sm inline-flex items-center gap-1"
            });
            b.appendChild(icon(iconName, "text-base"));
            b.appendChild(document.createTextNode(text));
            if (extra && extra.disabled) { b.disabled = true; b.classList.add("opacity-50", "cursor-not-allowed"); b.title = extra.title || ""; }
            b.addEventListener("click", onClick);
            box.appendChild(b);
            return b;
        };

        if (!state.editing) {
            btn("Customize", "dashboard_customize", () => { state.editing = true; rerender(); });
        } else {
            btn("Add block", "add", openAddBlock);
            const saveable = state.canEdit && (state.supported || state.demo);
            if (state.currentId && saveable) btn("Save", "save", () => save(false), true);
            if (saveable) btn("Save as new", "save_as", () => save(true), !state.currentId);
            if (saveable) btn("More", "more_horiz", openMore);
            btn("Done", "check", () => { state.editing = false; rerender(); });
        }
        bar.appendChild(box);

        const note = noticeText();
        if (note) {
            const n = el("p", { class: "text-xs text-slate-600 mt-2 px-1", role: "status" }, note);
            bar.appendChild(n);
        }
    }

    function noticeText() {
        if (state.notice) return state.notice;
        if (!state.editing) return "";
        if (state.demo) return "Demo: saved layouts last only until you close this tab.";
        if (!state.supported) return "Your changes apply until you leave this page. To save shared layouts, this school's tracker needs the 3.1.0 update. Its administrator sees an update notice in Admin.";
        if (!state.canEdit) return "Your changes apply until you leave this page. Only administrators can save shared layouts.";
        return "Drag blocks by the handle or use the arrows. Changes are shared with everyone at this school once you save.";
    }

    function flash(text) {
        state.notice = text;
        renderBar();
        clearTimeout(flash.t);
        flash.t = setTimeout(() => { state.notice = ""; renderBar(); }, 6000);
    }

    function selectLayout(id) {
        const l = state.layouts.find(x => x.id === id);
        state.currentId = l ? l.id : "";
        state.working = sanitizeLayout(l ? l.layout : STANDARD);
        state.dirty = false;
        rerender();
    }

    /* ---------------- Dialogs ---------------- */

    function dialog(title, buildBody, actions, onDismiss) {
        const overlay = el("div", { class: "rb-overlay no-print", role: "dialog", "aria-modal": "true", "aria-label": title });
        const panel = el("div", { class: "rb-panel" });
        panel.appendChild(el("h2", { class: "text-xl font-extrabold text-slate-900 mb-4" }, title));
        const body = el("div", { class: "space-y-4" });
        buildBody(body);
        panel.appendChild(body);

        const foot = el("div", { class: "flex justify-end gap-2 mt-6" });
        const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); };
        const onKey = ev => { if (ev.key === "Escape") { close(); if (onDismiss) onDismiss(); } };
        (actions || []).forEach(a => {
            const b = el("button", {
                type: "button",
                class: (a.primary ? "bg-blue-800 hover:bg-blue-900 text-white" : a.danger ? "bg-white text-red-700 border border-red-200" : "bg-white text-slate-800 border border-slate-300") +
                    " font-bold px-4 py-2 rounded-lg text-sm"
            }, a.text);
            b.addEventListener("click", async () => {
                if (!a.run) return close();
                const keep = await a.run();
                if (keep !== true) close();
            });
            foot.appendChild(b);
        });
        panel.appendChild(foot);
        overlay.appendChild(panel);
        const dismiss = () => { close(); if (onDismiss) onDismiss(); };
        overlay.addEventListener("click", ev => { if (ev.target === overlay) dismiss(); });
        document.addEventListener("keydown", onKey);
        document.body.appendChild(overlay);
        const first = panel.querySelector("input,select,textarea,button");
        if (first) first.focus();
        return { close, panel };
    }

    function field(labelText, control, hint) {
        const wrap = el("div");
        const id = "rbf" + uid();
        control.id = id;
        wrap.appendChild(el("label", { for: id, class: "block text-sm font-bold text-slate-700 mb-1" }, labelText));
        wrap.appendChild(control);
        if (hint) wrap.appendChild(el("p", { class: "text-xs text-slate-500 mt-1" }, hint));
        return wrap;
    }

    function selectControl(options, value) {
        const s = el("select", { class: "w-full p-2 border border-slate-300 rounded-lg bg-white" });
        options.forEach(([v, label, group]) => {
            let parent = s;
            if (group) {
                parent = [...s.querySelectorAll("optgroup")].find(g => g.label === group);
                if (!parent) { parent = el("optgroup", { label: group }); s.appendChild(parent); }
            }
            parent.appendChild(el("option", { value: v }, label));
        });
        s.value = value;
        if (s.value !== value && options.length) {
            // Saved choice no longer exists (e.g., a renamed task): keep it visible.
            const missing = el("option", { value }, measureLabel(value) + " (no current scores)");
            s.appendChild(missing);
            s.value = value;
        }
        return s;
    }

    function measureOptions() {
        const items = availableItems();
        return [
            ["overall", "Overall average", "Averages"],
            ["behavior", "Behavioral skills average", "Averages"],
            ["tasks", "Job tasks average", "Averages"],
            ...items.skills.map(n => ["skill:" + n, n, "One behavioral skill"]),
            ...items.tasks.map(n => ["task:" + n, n, "One job task"])
        ];
    }

    function openSettings(block) {
        const draft = clone(block);
        let titleInput, controls = {};

        dialog((BUILTIN[block.type] || CUSTOM[block.type]).label + " settings", body => {
            titleInput = el("input", { type: "text", maxlength: String(MAX_TITLE), class: "w-full p-2 border border-slate-300 rounded-lg", placeholder: defaultTitle(block) || "No heading" });
            titleInput.value = draft.title;
            if (block.type !== "header" && block.type !== "summary") {
                body.appendChild(field("Heading", titleInput, "Leave blank to use the standard heading."));
            }

            if (block.type === "behavior" || block.type === "tasks") {
                ["showChart", "showTiles"].forEach(key => {
                    const row = el("label", { class: "flex items-center gap-2 text-sm font-semibold text-slate-800" });
                    const cb = el("input", { type: "checkbox", class: "w-4 h-4" });
                    cb.checked = draft.options[key] !== false;
                    controls[key] = cb;
                    row.appendChild(cb);
                    row.appendChild(document.createTextNode(key === "showChart" ? "Show the chart" : "Show the score tiles"));
                    body.appendChild(row);
                });
            }

            if (block.type === "chart" || block.type === "table") {
                const dimKey = block.type === "chart" ? "groupBy" : "rows";
                const dim = selectControl(Object.entries(DIMENSIONS).map(([k, v]) => [k, v.label]), draft.options[dimKey]);
                const measure = selectControl(measureOptions(), draft.options.measure);
                const measureField = field("What to measure", measure);
                const sync = () => { measureField.style.display = itemDimension(dim.value) ? "none" : ""; };
                dim.addEventListener("change", sync);
                controls.dim = dim; controls.measure = measure; controls.dimKey = dimKey;
                body.appendChild(field(block.type === "chart" ? "Break down by" : "One row per", dim,
                    "Behavioral skill and Job task show every skill or task's own average."));
                body.appendChild(measureField);
                sync();

                if (block.type === "chart") {
                    controls.style = selectControl(Object.entries(STYLES), draft.options.style);
                    body.appendChild(field("Chart style", controls.style));
                } else {
                    const box = el("fieldset", { class: "grid grid-cols-2 gap-2" });
                    box.appendChild(el("legend", { class: "text-sm font-bold text-slate-700 mb-1 col-span-2" }, "Columns"));
                    controls.cols = {};
                    Object.entries(COLUMNS).forEach(([k, label]) => {
                        const row = el("label", { class: "flex items-center gap-2 text-sm" });
                        const cb = el("input", { type: "checkbox", class: "w-4 h-4" });
                        cb.checked = draft.options.columns.includes(k);
                        controls.cols[k] = cb;
                        row.appendChild(cb);
                        row.appendChild(document.createTextNode(label));
                        box.appendChild(row);
                    });
                    body.appendChild(box);
                    body.appendChild(el("p", { class: "text-xs text-slate-500" }, "Change = latest score minus first score in the report period."));
                }
            }

            if (block.type === "text") {
                const ta = el("textarea", { rows: "8", maxlength: String(MAX_TEXT), class: "w-full p-2 border border-slate-300 rounded-lg" });
                ta.value = draft.options.text || "";
                controls.text = ta;
                body.appendChild(field("Text", ta, "Plain text. Line breaks are kept. This text is part of the layout, so it appears on every student's report that uses it."));
            }

            if (block.type === "notes") {
                controls.order = selectControl([["newest", "Newest first"], ["oldest", "Oldest first"]], draft.options.order);
                body.appendChild(field("Order", controls.order));
            }
        }, [
            { text: "Cancel" },
            {
                text: "Apply", primary: true, run: () => {
                    block.title = str(titleInput.value, MAX_TITLE).trim();
                    if (controls.showChart) {
                        block.options.showChart = controls.showChart.checked;
                        block.options.showTiles = controls.showTiles.checked;
                    }
                    if (controls.dim) {
                        block.options[controls.dimKey] = controls.dim.value;
                        block.options.measure = validMeasure(controls.measure.value);
                    }
                    if (controls.style) block.options.style = controls.style.value;
                    if (controls.cols) {
                        const cols = Object.keys(COLUMNS).filter(k => controls.cols[k].checked);
                        block.options.columns = cols.length ? cols : ["avg"];
                    }
                    if (controls.text) block.options.text = str(controls.text.value, MAX_TEXT);
                    if (controls.order) block.options.order = controls.order.value;
                    changed(block.id);
                }
            }
        ]);
    }

    function openAddBlock() {
        const present = new Set(state.working.blocks.map(b => b.type));
        const d = dialog("Add a block", body => {
            const list = el("div", { class: "grid gap-2" });
            const addItem = (type, info, group) => {
                const b = el("button", { type: "button", class: "text-left border border-slate-200 hover:border-blue-400 hover:bg-blue-50 rounded-lg p-3" });
                b.appendChild(el("div", { class: "font-bold text-slate-900" }, info.label));
                b.appendChild(el("div", { class: "text-xs text-slate-600" }, info.desc));
                b.addEventListener("click", () => {
                    const block = sanitizeBlock({ type }, new Set());
                    state.working.blocks.push(block);
                    d.close();
                    changed(block.id);
                    if (type === "chart" || type === "table" || type === "text") openSettings(block);
                });
                list.appendChild(b);
            };
            body.appendChild(el("h3", { class: "text-sm font-bold text-slate-500" }, "Build your own"));
            Object.entries(CUSTOM).forEach(([t, info]) => addItem(t, info));
            const missing = Object.entries(BUILTIN).filter(([t]) => !present.has(t));
            body.appendChild(list);
            if (missing.length) {
                body.appendChild(el("h3", { class: "text-sm font-bold text-slate-500 pt-2" }, "Standard sections not in this layout"));
                const list2 = el("div", { class: "grid gap-2" });
                missing.forEach(([t, info]) => {
                    const b = el("button", { type: "button", class: "text-left border border-slate-200 hover:border-blue-400 hover:bg-blue-50 rounded-lg p-3" });
                    b.appendChild(el("div", { class: "font-bold text-slate-900" }, info.label));
                    b.appendChild(el("div", { class: "text-xs text-slate-600" }, info.desc));
                    b.addEventListener("click", () => {
                        const block = sanitizeBlock({ type: t }, new Set());
                        state.working.blocks.push(block);
                        d.close();
                        changed(block.id);
                    });
                    list2.appendChild(b);
                });
                body.appendChild(list2);
            }
            body.appendChild(el("p", { class: "text-xs text-slate-500" }, "New blocks go at the end. Move them with the arrows or by dragging."));
        }, [{ text: "Close" }]);
    }

    function openMore() {
        const isDefault = state.currentId
            ? !!(state.layouts.find(l => l.id === state.currentId) || {}).isDefault
            : !state.layouts.some(l => l.isDefault);
        dialog("Layout options", body => {
            body.appendChild(el("p", { class: "text-sm text-slate-700" },
                "\"" + currentName() + "\"" + (isDefault ? " is the school default: it opens first for everyone." : " is not the school default.")));
        }, [
            { text: "Close" },
            ...(state.currentId ? [{ text: "Delete layout", danger: true, run: () => removeLayout() }] : []),
            ...(!isDefault && !state.dirty ? [{ text: "Make school default", primary: true, run: () => makeDefault() }] : [])
        ]);
    }

    /* ---------------- Backend calls ---------------- */

    async function call(payload, write, code) {
        if (state.demo) return demoCall(payload);
        // Writes are sent once; reads retry once (see fetchJson in report.html).
        return fetchJson({
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(Object.assign({ code: code || reportCodeValue }, payload))
        }, write ? 1 : 2);
    }

    /** Never throws: layouts are optional, so a failure just means Standard. */
    async function fetchLayouts(code) {
        try {
            return await call({ action: "listLayouts" }, false, code);
        } catch (err) {
            console.warn("Layouts unavailable:", err);
            return null;
        }
    }

    async function loadLayouts() {
        applyLayouts(await fetchLayouts());
    }

    function applyLayouts(json) {
        state.supported = false;
        state.canEdit = false;
        state.layouts = [];
        try {
            if (json && json.status === "success" && Array.isArray(json.layouts)) {
                state.supported = true;
                state.canEdit = json.canEdit === true && viewerRole === "admin";
                state.layouts = json.layouts
                    .filter(l => l && typeof l.id === "string")
                    .map(l => ({
                        id: str(l.id, 100),
                        name: str(l.name, 60) || "Untitled layout",
                        layout: sanitizeLayout(l.layout),
                        updatedBy: str(l.updatedBy, 80),
                        updatedAt: str(l.updatedAt, 40),
                        isDefault: l.isDefault === true
                    }));
            }
            // Older backends answer "Unknown action": layouts simply aren't saved there yet.
        } catch (err) {
            console.warn("Layouts couldn't be read:", err);
        }
        const def = state.layouts.find(l => l.isDefault);
        state.currentId = def ? def.id : "";
        state.working = sanitizeLayout(def ? def.layout : STANDARD);
        state.dirty = false;
    }

    function askName(initial) {
        return new Promise(resolve => {
            let input;
            dialog("Save as a new shared layout", body => {
                input = el("input", { type: "text", maxlength: "60", class: "w-full p-2 border border-slate-300 rounded-lg", placeholder: "For example: Employer review packet" });
                input.value = initial || "";
                body.appendChild(field("Layout name", input, "Everyone with Reports access at this school will see it."));
            }, [
                { text: "Cancel", run: () => resolve(null) },
                { text: "Save", primary: true, run: () => {
                    const name = str(input.value, 60).trim();
                    if (!name) { input.focus(); return true; }
                    resolve(name);
                } }
            ], () => resolve(null));
        });
    }

    async function save(asNew) {
        const existing = state.layouts.find(l => l.id === state.currentId);
        let name = existing ? existing.name : "";
        if (asNew || !existing) {
            name = await askName(existing ? existing.name + " (copy)" : "");
            if (!name) return;
        }
        const payload = { action: "saveLayout", name, layout: exportLayout(state.working) };
        if (!asNew && existing) {
            payload.id = existing.id;
            payload.expectUpdatedAt = existing.updatedAt;
        }
        try {
            const json = await call(payload, true);
            if (json.status !== "success") {
                flash(json.message || "The layout wasn't saved.");
                return;
            }
            const saved = {
                id: json.layout.id,
                name: json.layout.name,
                layout: sanitizeLayout(json.layout.layout),
                updatedBy: json.layout.updatedBy,
                updatedAt: json.layout.updatedAt,
                isDefault: json.layout.isDefault === true
            };
            const i = state.layouts.findIndex(l => l.id === saved.id);
            if (i >= 0) state.layouts[i] = saved; else state.layouts.push(saved);
            state.currentId = saved.id;
            state.dirty = false;
            rerender();
            flash("Saved \"" + saved.name + "\" for everyone at this school.");
        } catch (err) {
            flash("Couldn't reach the tracker, so the layout wasn't saved. Your changes are still on screen; try Save again.");
        }
    }

    async function makeDefault() {
        try {
            const json = await call({ action: "setDefaultLayout", id: state.currentId }, true);
            if (json.status !== "success") { flash(json.message || "The default wasn't changed."); return; }
            state.layouts.forEach(l => { l.isDefault = l.id === state.currentId; });
            rerender();
            flash("\"" + currentName() + "\" now opens first for everyone at this school.");
        } catch (err) {
            flash("Couldn't reach the tracker. The default wasn't changed.");
        }
    }

    async function removeLayout() {
        const name = currentName();
        if (!confirm("Delete \"" + name + "\" for everyone at this school? This can't be undone.")) return true;
        try {
            const json = await call({ action: "deleteLayout", id: state.currentId }, true);
            if (json.status !== "success") { flash(json.message || "The layout wasn't deleted."); return; }
            state.layouts = state.layouts.filter(l => l.id !== state.currentId);
            const def = state.layouts.find(l => l.isDefault);
            selectLayout(def ? def.id : "");
            flash("Deleted \"" + name + "\".");
        } catch (err) {
            flash("Couldn't reach the tracker. The layout wasn't deleted.");
        }
    }

    /* ---------------- Demo backend (in memory) ---------------- */

    const demoStore = [];
    function demoCall(p) {
        const now = new Date().toISOString();
        if (p.action === "listLayouts") return Promise.resolve({ status: "success", canEdit: true, layouts: clone(demoStore) });
        if (p.action === "saveLayout") {
            let l = p.id && demoStore.find(x => x.id === p.id);
            if (!l) { l = { id: "LAY-demo-" + uid(), isDefault: false }; demoStore.push(l); }
            Object.assign(l, { name: p.name, layout: clone(p.layout), updatedBy: "Demo viewer", updatedAt: now });
            return Promise.resolve({ status: "success", layout: clone(l) });
        }
        if (p.action === "deleteLayout") {
            const i = demoStore.findIndex(x => x.id === p.id);
            if (i >= 0) demoStore.splice(i, 1);
            return Promise.resolve({ status: "success" });
        }
        if (p.action === "setDefaultLayout") {
            demoStore.forEach(x => { x.isDefault = x.id === p.id; });
            return Promise.resolve({ status: "success" });
        }
        return Promise.resolve({ status: "error", message: "Unknown action" });
    }

    function initDemo() {
        state.demo = true;
        state.supported = true;
        state.canEdit = true;
        state.working = sanitizeLayout(STANDARD);
    }

    /* ---------------- Styles ---------------- */

    const css = document.createElement("style");
    css.textContent = `
        .rb-frame { border: 2px dashed transparent; border-radius: 18px; }
        .rb-editing .rb-frame { border-color: #cbd5e1; padding: 6px; background: #f8fafc; }
        .rb-bar { display: flex; align-items: center; gap: 6px; padding: 2px 6px 6px; font: 600 13px/1.2 ui-sans-serif, system-ui, sans-serif; color: #334155; }
        .rb-handle { cursor: grab; color: #64748b; display: inline-flex; }
        .rb-handle:active { cursor: grabbing; }
        .rb-name { flex: 1; }
        .rb-tools { display: inline-flex; gap: 2px; }
        .rb-ctl { border: 1px solid #cbd5e1; background: #fff; border-radius: 8px; width: 32px; height: 30px; display: inline-flex; align-items: center; justify-content: center; color: #334155; }
        .rb-ctl:hover:not(:disabled) { background: #eff6ff; border-color: #93c5fd; }
        .rb-ctl:disabled { opacity: .35; }
        .rb-ctl:focus-visible, .rb-handle:focus-visible { outline: 3px solid #2563eb; outline-offset: 1px; }
        .rb-dragging { opacity: .4; }
        .rb-drop-before { box-shadow: 0 -4px 0 #2563eb; }
        .rb-drop-after { box-shadow: 0 4px 0 #2563eb; }
        .rb-pagebreak { border-top: 2px dashed #94a3b8; text-align: center; margin: 10px 0 4px; }
        .rb-pagebreak span { position: relative; top: -10px; background: #f8fafc; padding: 0 8px; font: 700 11px ui-sans-serif, system-ui; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
        .rb-hidden-note { padding: 10px 14px; border-radius: 12px; background: #f1f5f9; color: #475569; font-size: 13px; }
        .rb-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.7); z-index: 80; display: flex; align-items: center; justify-content: center; padding: 16px; }
        .rb-panel { background: #fff; border-radius: 16px; padding: 24px; width: 100%; max-width: 560px; max-height: 90vh; overflow: auto; }
        #reportBlocks.space-y-6 > * + * { margin-top: 1.5rem; }
        @media print {
            .rb-frame { border: 0 !important; padding: 0 !important; background: none !important; }
            .rb-empty-text { display: none !important; }
            #reportBlocks > * + * { margin-top: .75rem !important; }
            .rb-cover { padding: .75rem 1rem !important; }
            .rb-cover .text-3xl { font-size: 1.5rem !important; }
            .rb-cover .cover-grid > div { padding: .5rem .75rem !important; }
            #strengthsNeeds { gap: .5rem !important; }
            #strengthsNeeds > div { padding: .5rem .75rem !important; }
            #strengthsNeeds ul > li { font-size: .75rem !important; margin-top: .25rem !important; }
        }
    `;
    document.head.appendChild(css);

    return {
        render,
        loadLayouts,
        fetchLayouts,
        applyLayouts,
        initDemo,
        sanitizeLayout,        // exposed for tests
        _state: state
    };
})();
