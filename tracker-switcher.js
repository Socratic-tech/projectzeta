/************************************************************
 * TRACKER SWITCHER
 *
 * Lets one person (a coordinator or helper) keep several schools'
 * trackers in one browser and move between them.
 *
 * Load this in <head> AFTER the page's vtKey() script and BEFORE the
 * page's own scripts. It must run before the page reads the backend
 * URL or any saved access code.
 *
 * Security model
 *  - Each school's tracker stays fully separate. Nothing here grants
 *    access; every school's own codes are still checked by that
 *    school's backend.
 *  - Access codes are kept per tracker. When the active tracker
 *    changes (by this switcher, the setup page, or a QR scan), the
 *    codes for the old tracker are set aside and only the new
 *    tracker's codes (if any) are restored. A code is never sent to
 *    a different school's backend.
 *  - Codes stay in sessionStorage as before: close the tab, lose them.
 *  - Trackers are only added after the setup page or a QR link has
 *    validated the URL. This file never accepts a typed URL.
 *  - Saved names are local to this browser and always rendered as
 *    text, never HTML.
 *  - The switcher bar only appears once two or more trackers are
 *    saved, so single-school devices look exactly as before.
 ************************************************************/
(function () {
    "use strict";

    var key = typeof vtKey === "function" ? vtKey : function (n) { return n; };

    var URL_KEY = key("vocational_backend_url");
    var LIST_KEY = key("vt_trackers");
    var OWNER_KEY = key("vt_codes_for");
    var CODE_KEYS = [key("vt_report_code"), key("vt_admin_code"), key("vt_admin_pass")];
    var MAX_NAME = 40;

    function stashKey(url) {
        return key("vt_codes:") + url;
    }

    function readList() {
        try {
            var list = JSON.parse(localStorage.getItem(LIST_KEY) || "[]");
            return Array.isArray(list)
                ? list.filter(function (t) { return t && typeof t.url === "string" && t.url; })
                : [];
        } catch (e) {
            return [];
        }
    }

    function writeList(list) {
        try { localStorage.setItem(LIST_KEY, JSON.stringify(list)); } catch (e) { /* storage full or blocked */ }
    }

    function cleanName(name) {
        return String(name || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, MAX_NAME);
    }

    // ---- 1. Register the active tracker --------------------------------
    var currentUrl = null;
    try { currentUrl = localStorage.getItem(URL_KEY); } catch (e) { /* blocked */ }

    var list = readList();
    if (currentUrl && !list.some(function (t) { return t.url === currentUrl; })) {
        list.push({ url: currentUrl, name: "" });
        writeList(list);
    }

    // ---- 2. Keep access codes with the tracker they belong to ----------
    try {
        var owner = sessionStorage.getItem(OWNER_KEY);

        if (owner !== currentUrl) {
            // Set aside codes that belong to the previous tracker
            if (owner) {
                var saved = {};
                CODE_KEYS.forEach(function (k) {
                    var v = sessionStorage.getItem(k);
                    if (v) saved[k] = v;
                });
                if (Object.keys(saved).length) {
                    sessionStorage.setItem(stashKey(owner), JSON.stringify(saved));
                }
            }

            // Clear, then restore only this tracker's codes
            CODE_KEYS.forEach(function (k) { sessionStorage.removeItem(k); });

            if (currentUrl) {
                var stash = sessionStorage.getItem(stashKey(currentUrl));
                if (stash) {
                    var codes = JSON.parse(stash);
                    CODE_KEYS.forEach(function (k) {
                        if (typeof codes[k] === "string") sessionStorage.setItem(k, codes[k]);
                    });
                }
                sessionStorage.setItem(OWNER_KEY, currentUrl);
            } else {
                sessionStorage.removeItem(OWNER_KEY);
            }
        }
    } catch (e) {
        // If anything goes wrong, fail closed: drop all codes.
        try { CODE_KEYS.forEach(function (k) { sessionStorage.removeItem(k); }); } catch (e2) { /* ignore */ }
    }

    // ---- Public helpers -------------------------------------------------
    function currentName() {
        var t = readList().filter(function (x) { return x.url === currentUrl; })[0];
        return t ? cleanName(t.name) : "";
    }

    function switchTo(url) {
        if (!url || url === currentUrl) return;
        if (!readList().some(function (t) { return t.url === url; })) return;
        localStorage.setItem(URL_KEY, url);
        location.reload();
    }

    window.VTTrackers = {
        currentUrl: function () { return currentUrl; },
        currentName: currentName,
        count: function () { return readList().length; }
    };

    // ---- 3. Switcher bar + manage dialog ------------------------------
    function el(tag, attrs, text) {
        var node = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (a) { node.setAttribute(a, attrs[a]); });
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function shortUrl(url) {
        var m = /\/macros\/s\/([^/]+)\//.exec(url);
        return m ? "…" + m[1].slice(-8) : url.slice(0, 32) + "…";
    }

    function label(t, i) {
        return cleanName(t.name) || ("Unnamed tracker " + (i + 1));
    }

    function injectStyles() {
        var css = el("style");
        css.textContent =
            ".vt-sw{background:#0f172a;color:#e2e8f0;font:500 13px/1.3 ui-sans-serif,system-ui,sans-serif}" +
            ".vt-sw-in{max-width:80rem;margin:0 auto;padding:6px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:8px}" +
            ".vt-sw select{background:#1e293b;color:#fff;border:1px solid #475569;border-radius:6px;padding:4px 8px;font:600 13px ui-sans-serif,system-ui,sans-serif;max-width:60vw}" +
            ".vt-sw button{background:transparent;color:#cbd5e1;border:1px solid #475569;border-radius:6px;padding:4px 10px;font:600 12px ui-sans-serif,system-ui,sans-serif;cursor:pointer}" +
            ".vt-sw button:hover,.vt-sw button:focus-visible{color:#fff;border-color:#94a3b8}" +
            ".vt-sw-dlg{position:fixed;inset:0;background:rgba(15,23,42,.8);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px}" +
            ".vt-sw-card{background:#fff;color:#0f172a;border-radius:16px;max-width:560px;width:100%;padding:24px;font:14px/1.45 ui-sans-serif,system-ui,sans-serif;max-height:90vh;overflow:auto}" +
            ".vt-sw-card h2{font-size:20px;font-weight:800;margin:0 0 4px}" +
            ".vt-sw-card p{color:#475569;margin:0 0 16px;font-size:13px}" +
            ".vt-sw-row{display:flex;gap:8px;align-items:center;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;margin-bottom:8px}" +
            ".vt-sw-row input{flex:1;min-width:0;border:1px solid #cbd5e1;border-radius:6px;padding:6px 8px;font:14px ui-sans-serif,system-ui,sans-serif}" +
            ".vt-sw-row small{color:#64748b;white-space:nowrap}" +
            ".vt-sw-card .btn{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer}" +
            ".vt-sw-card .btn-primary{background:#1e3a8a;border-color:#1e3a8a;color:#fff}" +
            ".vt-sw-card .btn-danger{color:#b91c1c;border-color:#fecaca;padding:6px 10px}" +
            ".vt-sw-card .btn[disabled]{opacity:.4;cursor:not-allowed}" +
            ".vt-sw-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap}" +
            "@media print{.vt-sw,.vt-sw-dlg{display:none!important}}";
        document.head.appendChild(css);
    }

    function openManage() {
        var trackers = readList();
        var dlg = el("div", { "class": "vt-sw-dlg", role: "dialog", "aria-modal": "true", "aria-labelledby": "vtSwTitle" });
        var card = el("div", { "class": "vt-sw-card" });
        card.appendChild(el("h2", { id: "vtSwTitle" }, "Saved trackers"));
        card.appendChild(el("p", {}, "Names are only saved in this browser. Each school's codes are kept separate and are only ever sent to that school's tracker."));

        var inputs = [];
        trackers.forEach(function (t, i) {
            var row = el("div", { "class": "vt-sw-row" });
            var input = el("input", { type: "text", maxlength: String(MAX_NAME), "aria-label": "Name for tracker " + (i + 1), placeholder: "School or program name" });
            input.value = cleanName(t.name);
            inputs.push({ input: input, url: t.url });
            row.appendChild(input);
            row.appendChild(el("small", { title: "Tracker address ending" }, t.url === currentUrl ? "Current" : shortUrl(t.url)));

            var remove = el("button", { type: "button", "class": "btn btn-danger" }, "Remove");
            if (t.url === currentUrl) {
                remove.disabled = true;
                remove.title = "Switch to another tracker before removing this one";
            }
            remove.addEventListener("click", function () {
                if (!confirm("Remove \"" + label(t, i) + "\" from this browser? Its data is not affected.")) return;
                writeList(readList().filter(function (x) { return x.url !== t.url; }));
                try { sessionStorage.removeItem(stashKey(t.url)); } catch (e) { /* ignore */ }
                dlg.remove();
                openManage();
            });
            row.appendChild(remove);
            card.appendChild(row);
        });

        var foot = el("div", { "class": "vt-sw-foot" });
        var add = el("a", { href: "setup.html", "class": "btn" }, "Add another tracker");
        var right = el("div", {});
        var cancel = el("button", { type: "button", "class": "btn" }, "Cancel");
        var save = el("button", { type: "button", "class": "btn btn-primary", style: "margin-left:8px" }, "Save names");
        cancel.addEventListener("click", function () { dlg.remove(); });
        save.addEventListener("click", function () {
            var latest = readList();
            inputs.forEach(function (x) {
                latest.forEach(function (t) { if (t.url === x.url) t.name = cleanName(x.input.value); });
            });
            writeList(latest);
            location.reload();
        });
        right.appendChild(cancel);
        right.appendChild(save);
        foot.appendChild(add);
        foot.appendChild(right);
        card.appendChild(foot);

        dlg.appendChild(card);
        dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.remove(); });
        dlg.addEventListener("keydown", function (e) { if (e.key === "Escape") dlg.remove(); });
        document.body.appendChild(dlg);
        if (inputs[0]) inputs[0].input.focus();
    }

    function renderBar() {
        var trackers = readList();
        if (trackers.length < 2 || !currentUrl) return;

        injectStyles();

        var bar = el("div", { "class": "vt-sw", role: "region", "aria-label": "Tracker switcher" });
        var inner = el("div", { "class": "vt-sw-in" });

        var lab = el("label", { "for": "vtSwSelect" }, "Tracker:");
        var select = el("select", { id: "vtSwSelect" });
        trackers.forEach(function (t, i) {
            var opt = el("option", {}, label(t, i));
            opt.value = t.url;
            if (t.url === currentUrl) opt.selected = true;
            select.appendChild(opt);
        });
        select.addEventListener("change", function () { switchTo(select.value); });

        var manage = el("button", { type: "button" }, currentName() ? "Manage" : "Name this tracker");
        manage.addEventListener("click", openManage);

        inner.appendChild(lab);
        inner.appendChild(select);
        inner.appendChild(manage);
        bar.appendChild(inner);

        var nav = document.querySelector("body > nav");
        if (nav && nav.nextSibling) nav.parentNode.insertBefore(bar, nav.nextSibling);
        else document.body.prepend(bar);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", renderBar);
    } else {
        renderBar();
    }
})();
