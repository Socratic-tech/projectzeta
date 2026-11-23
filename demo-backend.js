/************************************************************
 * DEMO BACKEND (preview site only)
 *
 * Makes the PREVIEW copy of the site work on its own, with no Google
 * Sheet or Apps Script behind it: sample students, sites, tasks and
 * scores, and every page signed in automatically.
 *
 * It does nothing unless VT_ENV === "PREVIEW", which only the
 * tools/deploy-preview.sh build sets. On the live site (VT_ENV = "")
 * this file is inert, so it is safe to leave on every page.
 *
 * Load it after the page's VT_ENV / vtKey() script and BEFORE
 * tracker-switcher.js and the page's own scripts.
 *
 * What it does
 *  - Saves a fake backend URL and entry code, and signs in as admin
 *    (once per browser tab, so Sign out and the sign-in box still work;
 *    any non-empty access code is accepted).
 *  - Replaces fetch() for that fake URL with an in-browser database
 *    kept in localStorage, so changes made on the Admin or Entry page
 *    show up in Reports.
 *  - Open any page with ?resetdemo=1 to restore the original samples.
 *
 * All sample people are made up. No real student data belongs here.
 ************************************************************/
(function () {
    "use strict";

    if (typeof VT_ENV === "undefined" || VT_ENV !== "PREVIEW") return;

    var key = typeof vtKey === "function" ? vtKey : function (n) { return "PREVIEW:" + n; };

    var FAKE_URL = "https://script.google.com/macros/s/DEMO-PREVIEW-ONLY/exec";
    var ENTRY_TOKEN = "DEMO-ENTRY-CODE";
    var DEMO_CODE = "DEMO";
    var API_VERSION = 3;
    var RELEASE = "3.1.0";
    var DB_KEY = key("demo_db");

    var SKILLS = [
        "Punctual", "Prepared with Necessary Materials", "Demonstrates appropriate hygiene/dress",
        "Initiates familiar tasks", "Maintains a productive work rate", "Complete tasks in a logical order",
        "Demonstrates adaptability", "Work is completed to quality standards",
        "Maintains clean and organized work space", "Awareness of surroundings and good decision making",
        "Appropriate and respectful social interactions", "Displays effective communication skills",
        "Accepts constructive criticism", "Demonstrates a positive attitude",
        "Asks for help appropriately", "Demonstrates self-reflection"
    ];

    function clone(o) { return JSON.parse(JSON.stringify(o)); }

    /* ---------- Sample data ---------- */

    function seedRandom(seed) {
        var r = seed >>> 0;
        return function () {
            r = (r + 0x6D2B79F5) >>> 0;
            var t = r;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function buildSeed() {
        var rand = seedRandom(20261123);
        var pick = function (list) { return list[Math.floor(rand() * list.length)]; };
        var clamp = function (n) { return Math.max(0, Math.min(4, n)); };

        var siteTasks = {
            "Riverside Cafe": ["Wipe tables", "Restock napkins", "Run dishwasher"],
            "Goodwill Store": ["Hang clothing", "Sort donations", "Price items"],
            "ACE Hardware": ["Stock shelves", "Face products", "Sort recycling"]
        };
        var sites = Object.keys(siteTasks);
        var tasks = [];
        sites.forEach(function (s) {
            siteTasks[s].forEach(function (t) { tasks.push({ site_name: s, task_name: t }); });
        });

        var students = [
            { student_id: "DEMO1", name: "Jordan Reyes (sample)", grade: "11", active: true },
            { student_id: "DEMO2", name: "Taylor Brooks (sample)", grade: "12", active: true },
            { student_id: "DEMO3", name: "Casey Morgan (sample)", grade: "10", active: true },
            { student_id: "DEMO4", name: "Riley Chen (sample)", grade: "11", active: true },
            { student_id: "DEMO5", name: "Avery Patel (sample)", grade: "12", active: false }
        ];

        var evaluators = ["M. Lopez", "D. Carter", "S. Nguyen"];
        var notes = ["", "", "Good shift.", "Needed a reminder after break.",
            "Helped a new student with setup.", "Arrived early."];

        var entries = [];
        var today = new Date();

        students.forEach(function (student, sIndex) {
            var skillBase = {};
            SKILLS.forEach(function (sk) { skillBase[sk] = pick([1, 2, 2, 3, 3, 3, 4]); });
            var taskBase = {};
            tasks.forEach(function (t) { taskBase[t.task_name] = pick([1, 2, 3, 3, 4]); });

            var visits = 14 - sIndex * 2;
            for (var i = 0; i < visits; i++) {
                var site = sites[i % sites.length];
                var date = new Date(today);
                date.setDate(today.getDate() - (visits - i) * 4);
                var growth = i / visits;
                var scores = {};
                SKILLS.forEach(function (sk) {
                    scores[sk] = clamp(Math.round(skillBase[sk] + growth + (rand() - 0.5) * 1.6));
                });
                siteTasks[site].forEach(function (t) {
                    if (rand() < 0.85) {
                        scores["task:" + t] = clamp(Math.round(taskBase[t] + growth + (rand() - 0.5) * 1.6));
                    }
                });
                entries.push({
                    student_id: student.student_id,
                    date: date.toISOString(),
                    job_site: site,
                    evaluator: pick(evaluators),
                    comments: pick(notes),
                    scores: scores
                });
            }
        });

        return { students: students, sites: sites, tasks: tasks, entries: entries, layouts: [], nextId: 6 };
    }

    /* ---------- Storage ---------- */

    var memoryDb = null;

    try {
        if (new URLSearchParams(location.search).get("resetdemo") === "1") {
            localStorage.removeItem(DB_KEY);
            sessionStorage.removeItem(key("demo_signed_in"));
        }
    } catch (e) { /* storage blocked */ }

    function loadDb() {
        if (memoryDb) return memoryDb;
        try {
            var raw = localStorage.getItem(DB_KEY);
            if (raw) { memoryDb = JSON.parse(raw); return memoryDb; }
        } catch (e) { /* fall through to a fresh seed */ }
        memoryDb = buildSeed();
        saveDb();
        return memoryDb;
    }

    function saveDb() {
        try { localStorage.setItem(DB_KEY, JSON.stringify(memoryDb)); } catch (e) { /* kept in memory */ }
    }

    /* ---------- Auto sign-in ---------- */

    try {
        localStorage.setItem(key("vocational_backend_url"), FAKE_URL);
        localStorage.setItem(key("vt_entry_token"), ENTRY_TOKEN);
        if (!localStorage.getItem(key("vt_evaluator_name"))) {
            localStorage.setItem(key("vt_evaluator_name"), "Demo Teacher");
        }
        if (!sessionStorage.getItem(key("demo_signed_in"))) {
            sessionStorage.setItem(key("demo_signed_in"), "1");
            sessionStorage.setItem(key("vt_admin_code"), DEMO_CODE);
            sessionStorage.setItem(key("vt_report_code"), DEMO_CODE);
            sessionStorage.setItem(key("vt_codes_for"), FAKE_URL);
        }
    } catch (e) { /* storage blocked: pages will show their normal not-connected screens */ }

    /* ---------- Fake server ---------- */

    function ok(extra) {
        return Object.assign({ status: "success", apiVersion: API_VERSION, release: RELEASE }, extra || {});
    }
    function fail(message, code) {
        return { status: "error", apiVersion: API_VERSION, release: RELEASE, message: message, code: code };
    }

    function handle(p) {
        var db = loadDb();
        var action = p.action;
        var hasCode = !!String(p.code || "").trim();

        // Entry page (token instead of a code)
        if (action === "entryBootstrap") {
            if (p.token !== ENTRY_TOKEN) return fail("This entry link is no longer valid.", "denied");
            return ok({ students: clone(db.students), sites: clone(db.sites), tasks: clone(db.tasks) });
        }
        if (action === "addEntry") {
            if (p.token !== ENTRY_TOKEN) return fail("This entry link is no longer valid.", "denied");
            db.entries.push({
                student_id: p.student_id,
                date: p.date ? new Date(p.date + "T12:00:00").toISOString() : new Date().toISOString(),
                job_site: p.job_site,
                evaluator: p.evaluator || "",
                comments: p.comments || "",
                scores: p.scores || {}
            });
            saveDb();
            return ok();
        }

        // Everything else needs an access code (any non-empty code works)
        if (!hasCode) return fail("Code not recognized.", "denied");

        switch (action) {
            case "getEntries":
                return ok({
                    role: "admin", viewer: "Demo viewer",
                    data: clone(db.entries), students: clone(db.students), tasks: clone(db.tasks)
                });
            case "verifyAdmin":
                return ok({
                    admin: "Demo Administrator", adminEmail: "demo.admin@example.com",
                    entryToken: ENTRY_TOKEN
                });
            case "adminBootstrap":
                return ok({
                    students: clone(db.students), sites: clone(db.sites), tasks: clone(db.tasks),
                    adminEmail: "demo.admin@example.com", supportEmail: "support@example.com",
                    entryPageUrl: new URL("entry.html", location.href).href,
                    publicSiteBaseUrl: new URL("./", location.href).href
                });
            case "savePublicSiteSettings":
                return ok();
            case "rotateEntryToken":
                return ok({ entryToken: ENTRY_TOKEN });
            case "submitFeatureRequest":
                return ok({ emailed: false, requestId: "DEMO-REQ-1", supportEmail: "support@example.com" });

            case "addStudent":
                db.students.push({ student_id: "DEMO" + db.nextId++, name: p.name, grade: p.grade || "", active: true });
                break;
            case "updateStudent":
                db.students.forEach(function (s) {
                    if (s.student_id === p.student_id) { s.name = p.name; s.grade = p.grade; }
                });
                break;
            case "setStudentActive":
                db.students.forEach(function (s) {
                    if (s.student_id === p.student_id) s.active = p.active === true || p.active === "true";
                });
                break;
            case "deleteStudent":
                db.students = db.students.filter(function (s) { return s.student_id !== p.student_id; });
                db.entries = db.entries.filter(function (e) { return e.student_id !== p.student_id; });
                break;

            case "addSite":
                if (db.sites.indexOf(p.site_name) < 0) db.sites.push(p.site_name);
                break;
            case "deleteSite":
                db.sites = db.sites.filter(function (s) { return s !== p.site_name; });
                db.tasks = db.tasks.filter(function (t) { return t.site_name !== p.site_name; });
                break;
            case "addTask":
                db.tasks.push({ site_name: p.site_name, task_name: p.task_name });
                break;
            case "deleteTask":
                db.tasks = db.tasks.filter(function (t) {
                    return !(t.site_name === p.site_name && t.task_name === p.task_name);
                });
                break;

            // Shared report layouts
            case "listLayouts":
                return ok({ canEdit: true, layouts: clone(db.layouts) });
            case "saveLayout":
                var l = p.id && db.layouts.filter(function (x) { return x.id === p.id; })[0];
                if (!l) { l = { id: "LAY-demo-" + db.nextId++, isDefault: false }; db.layouts.push(l); }
                l.name = p.name; l.layout = clone(p.layout);
                l.updatedBy = "Demo viewer"; l.updatedAt = new Date().toISOString();
                saveDb();
                return ok({ layout: clone(l) });
            case "deleteLayout":
                db.layouts = db.layouts.filter(function (x) { return x.id !== p.id; });
                break;
            case "setDefaultLayout":
                db.layouts.forEach(function (x) { x.isDefault = x.id === p.id; });
                break;

            default:
                return fail("Demo backend does not know the action \"" + action + "\".");
        }
        saveDb();
        return ok();
    }

    function jsonResponse(obj) {
        return new Response(JSON.stringify(obj), {
            status: 200, headers: { "Content-Type": "application/json" }
        });
    }

    var realFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
        var url = typeof input === "string" ? input : (input && input.url) || "";
        if (url.indexOf(FAKE_URL) !== 0) return realFetch(input, init);

        var method = ((init && init.method) || "GET").toUpperCase();
        if (method === "GET") {
            return Promise.resolve(jsonResponse({
                status: "online", apiVersion: API_VERSION, release: RELEASE
            }));
        }
        var payload = {};
        try { payload = JSON.parse((init && init.body) || "{}"); } catch (e) { /* empty */ }
        return Promise.resolve(jsonResponse(handle(payload)));
    };
})();
