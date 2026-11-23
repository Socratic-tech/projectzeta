/************************************************************
 * JOB COMPLEXITY (shared)
 *
 * The "Vocational Readiness Tracker: Job Complexity" rubric. Each job
 * task is rated 0-4 on five rows. The overall level is the average of
 * the rows that were rated, rounded to the nearest whole level.
 *
 * A task's rating travels with the task as
 *   complexity: { tasks, productivity, decision, social, environment }
 * (numbers 0-4; a missing row means "not rated"). Pages that don't
 * get a rating simply show nothing, so older backends keep working.
 *
 * Loaded by admin.html (rate tasks), entry.html and report.html (show).
 ************************************************************/
window.VTComplexity = (function () {
    "use strict";

    var LEVELS = [
        { n: 0, name: "Supported",   bg: "#f4c7c3", fg: "#7f1d1d" },
        { n: 1, name: "Routine",     bg: "#fde9a9", fg: "#78350f" },
        { n: 2, name: "Predictable", bg: "#fde9a9", fg: "#78350f" },
        { n: 3, name: "Standard",    bg: "#c6e0b4", fg: "#14532d" },
        { n: 4, name: "Advanced",    bg: "#c6e0b4", fg: "#14532d" }
    ];

    var ROWS = [
        {
            key: "tasks", label: "Tasks",
            levels: [
                "Tasks are simple, single-step, or highly repetitive. Performs a subset of tasks included in the job description.",
                "Tasks follow a familiar sequence or routine. A few steps required. Additional novel tasks assigned rarely. Performs a subset of tasks included in the job description.",
                "Tasks are generally predictable. Many steps required. Additional novel tasks assigned occasionally. Performs a subset of tasks included in the job description.",
                "Tasks require knowledge or skills specific to the context. Many steps required. Additional novel tasks assigned frequently. Performs all tasks included in the job description.",
                "Tasks require technical expertise or specialized training/certification. Many steps required. Additional novel tasks assigned frequently. Performs all tasks included in the job description."
            ]
        },
        {
            key: "productivity", label: "Productivity Standards",
            levels: [
                "None",
                "Output requirements are low and flexible.",
                "Output requirements are moderate and flexible.",
                "Output requirements are moderate with limited flexibility.",
                "Output requirements are high with limited flexibility."
            ]
        },
        {
            key: "decision", label: "Decision Making",
            levels: [
                "None",
                "Simple repetitive choices based on familiar routines.",
                "Makes minor choices or decisions when low-risk issues arise.",
                "Makes choices or decisions that impact workflow.",
                "Makes critical, time-sensitive choices or decisions that impact workflow and/or safety."
            ]
        },
        {
            key: "social", label: "Social Interactions",
            levels: [
                "None",
                "Limited communication skills with familiar people. Requires responses to directives, simple questions or greetings.",
                "Predictable communication with familiar and unfamiliar people. Requires simple conversation skills.",
                "Frequent communication with familiar and unfamiliar people. Requires ability to interpret social cues and adapt responses appropriately.",
                "Frequent communication with familiar and unfamiliar people. Requires ability to navigate complex social situations including heightened emotions, complaints or conflict."
            ]
        },
        {
            key: "environment", label: "Environment",
            levels: [
                "Controlled: No public interaction. No hazards.",
                "Controlled: Minimal or no public interaction and/or minor hazards that require basic awareness or general safety precautions.",
                "Structured: Occasional public interaction and/or occasional exposure to minor hazards that require specific precautions or personal protective equipment (PPE) to prevent minor bodily injuries.",
                "Variable: Frequent public interaction and/or frequent exposure to minor hazards that require specific precautions or personal protective equipment (PPE) to prevent minor bodily injury.",
                "Variable: Frequent public interaction that includes risky situations and/or major hazards that require complex safety precautions or personal protective equipment (PPE) to prevent major bodily injury."
            ]
        }
    ];

    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    /** Clean a rating: only 0-4 whole numbers kept. Returns null if nothing is rated. */
    function normalize(c) {
        if (!c || typeof c !== "object") return null;
        var out = {}, any = false;
        ROWS.forEach(function (row) {
            var v = c[row.key];
            if (v === null || v === undefined || v === "") return;
            var n = Number(v);
            if (Number.isInteger(n) && n >= 0 && n <= 4) { out[row.key] = n; any = true; }
        });
        return any ? out : null;
    }

    /** Overall 0-4 level (average of rated rows, rounded), or null. */
    function overall(c) {
        c = normalize(c);
        if (!c) return null;
        var vals = Object.keys(c).map(function (k) { return c[k]; });
        var avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
        return Math.min(4, Math.max(0, Math.round(avg)));
    }

    /** Small colored pill, e.g. "Complexity 2 · Predictable". */
    function badge(c, compact) {
        var lvl = overall(c);
        if (lvl === null) return "";
        var L = LEVELS[lvl];
        var text = compact ? "C" + lvl : "Complexity " + lvl + " · " + L.name;
        return '<span title="Job complexity: ' + lvl + " – " + esc(L.name) + '" style="display:inline-block;' +
            "padding:1px 8px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap;" +
            "background:" + L.bg + ";color:" + L.fg + ';-webkit-print-color-adjust:exact;print-color-adjust:exact">' +
            esc(text) + "</span>";
    }

    return { LEVELS: LEVELS, ROWS: ROWS, normalize: normalize, overall: overall, badge: badge, esc: esc };
})();
