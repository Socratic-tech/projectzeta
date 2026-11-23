/************************************************************
 * ACCESSIBILITY TOOLBAR (all pages)
 *
 * A small floating "Accessibility" button with display settings that
 * are remembered on this device:
 *   - Text size (100% to 200%)
 *   - High contrast
 *   - Readable font (Atkinson Hyperlegible, designed for low vision)
 *   - Reduce motion
 *   - Underline links
 *   - Speak instead of type (microphone on comment boxes; uses the
 *     browser's own speech recognition, nothing is sent by this site)
 *
 * Ported from the settings in the 3D Learning Lab
 * (socratic-tech/3dlearninglab: text size, contrast, readable font,
 * motion, dictation) as one dependency-free file, since these pages are
 * static HTML.
 *
 * Language: this file does not translate anything and sends no page
 * text anywhere. It explains how to use the browser's built-in
 * translate (Chrome, Edge, Safari), which keeps student information on
 * the device. Every page declares <html lang="en"> so the browser
 * offers it correctly.
 *
 * Settings are saved with vtKey() when a page defines it, so the
 * preview site keeps its own copy. They hold no personal information.
 ************************************************************/
(function () {
    "use strict";

    var key = typeof vtKey === "function" ? vtKey : function (n) { return n; };
    var STORE = key("vt_a11y");
    var DEFAULTS = { text: 100, contrast: false, readable: false, motion: false, links: false, dictate: false };
    var TEXT_STEPS = [100, 115, 130, 150, 175, 200];

    var prefs = load();

    function load() {
        var p = Object.assign({}, DEFAULTS);
        try {
            var saved = JSON.parse(localStorage.getItem(STORE) || "{}");
            if (TEXT_STEPS.indexOf(saved.text) >= 0) p.text = saved.text;
            ["contrast", "readable", "motion", "links", "dictate"].forEach(function (k) {
                if (saved[k] === true) p[k] = true;
            });
        } catch (e) { /* blocked or corrupt: use defaults */ }
        return p;
    }

    function save() {
        try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (e) { /* not saved */ }
    }

    /* ---------- Styles ---------- */

    var css = document.createElement("style");
    css.id = "vt-a11y-css";
    css.textContent = [
        /* toolbar itself */
        "#vt-a11y-btn{position:fixed;left:14px;bottom:14px;z-index:2147483000;width:46px;height:46px;border-radius:50%;border:2px solid #fff;background:#1e3a8a;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.35);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}",
        "#vt-a11y-btn:hover{background:#1d4ed8}",
        "#vt-a11y-btn svg{width:26px;height:26px;fill:currentColor}",
        "#vt-a11y-panel{position:fixed;left:14px;bottom:70px;z-index:2147483000;width:min(340px,calc(100vw - 28px));max-height:calc(100vh - 90px);overflow:auto;background:#fff;color:#0f172a;border:2px solid #1e3a8a;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.35);font:14px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;padding:14px 16px}",
        "#vt-a11y-panel[hidden]{display:none}",
        "#vt-a11y-panel *{box-sizing:border-box;font-family:inherit}",
        "#vt-a11y-panel h2{font-size:16px;margin:0 0 10px;font-weight:800;display:flex;justify-content:space-between;align-items:center}",
        "#vt-a11y-panel h3{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#475569;margin:12px 0 6px}",
        "#vt-a11y-panel button{font:inherit;cursor:pointer}",
        "#vt-a11y-panel .vt-row{display:flex;align-items:center;gap:8px}",
        "#vt-a11y-panel .vt-step{flex:1;border:1px solid #94a3b8;background:#f8fafc;border-radius:8px;padding:8px 0;font-weight:800;color:#0f172a}",
        "#vt-a11y-panel .vt-step:disabled{opacity:.4;cursor:not-allowed}",
        "#vt-a11y-panel .vt-size{min-width:56px;text-align:center;font-weight:800}",
        "#vt-a11y-panel .vt-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;border:1px solid #cbd5e1;background:#fff;border-radius:10px;padding:9px 12px;margin-bottom:6px;color:#0f172a}",
        "#vt-a11y-panel .vt-toggle small{display:block;color:#475569;font-size:12px}",
        "#vt-a11y-panel .vt-pill{flex:none;min-width:44px;text-align:center;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:800;background:#e2e8f0;color:#334155}",
        "#vt-a11y-panel .vt-toggle[aria-pressed=true]{border-color:#1e3a8a;background:#eff6ff}",
        "#vt-a11y-panel .vt-toggle[aria-pressed=true] .vt-pill{background:#1e3a8a;color:#fff}",
        "#vt-a11y-panel .vt-reset{margin-top:8px;width:100%;border:1px solid #94a3b8;background:#fff;border-radius:10px;padding:8px;font-weight:700;color:#0f172a}",
        "#vt-a11y-panel .vt-close{border:0;background:transparent;font-size:22px;line-height:1;padding:2px 6px;color:#334155}",
        "#vt-a11y-panel p{margin:0;color:#334155;font-size:13px}",
        "#vt-a11y-panel a{color:#1d4ed8}",
        "#vt-a11y-btn:focus-visible,#vt-a11y-panel button:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}",

        /* microphone beside comment boxes */
        ".vt-dictate{margin-top:6px;display:inline-flex;align-items:center;gap:6px;border:1px solid #94a3b8;background:#fff;color:#0f172a;border-radius:999px;padding:5px 12px;font:600 13px system-ui,sans-serif;cursor:pointer}",
        ".vt-dictate[aria-pressed=true]{background:#fee2e2;border-color:#b91c1c;color:#7f1d1d}",

        /* display options */
        "html.vt-motion *,html.vt-motion *::before,html.vt-motion *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}",
        "html.vt-links a{text-decoration:underline!important;text-underline-offset:2px}",
        "html.vt-readable body,html.vt-readable body *:not(.material-icons):not(.material-icons *):not(code):not(pre):not(canvas){font-family:'Atkinson Hyperlegible','Verdana',system-ui,sans-serif!important}",
        "html.vt-readable body{letter-spacing:.01em;line-height:1.6}",
        "html.vt-contrast body{background:#fff!important;color:#000!important}",
        "html.vt-contrast body :is([class*=text-slate],[class*=text-gray],[class*=text-zinc]){color:#111!important}",
        "html.vt-contrast body :is([class*=bg-slate-50],[class*=bg-slate-100],[class*=bg-gray-50],[class*=bg-gray-100]){background-color:#fff!important}",
        "html.vt-contrast body :is([class*=border-slate],[class*=border-gray],.border,.border-b,.border-t){border-color:#000!important}",
        "html.vt-contrast a{text-decoration:underline!important}",
        "html.vt-contrast :focus-visible{outline:3px solid #000!important;outline-offset:2px!important;box-shadow:0 0 0 6px #fde047!important}",
        "html.vt-contrast #vt-a11y-btn{background:#000;border-color:#fde047;color:#fde047}",
        "@media print{#vt-a11y-btn,#vt-a11y-panel,.vt-dictate{display:none!important}}"
    ].join("\n");
    document.head.appendChild(css);

    var fontLink = null;
    function ensureFont() {
        if (fontLink) return;
        fontLink = document.createElement("link");
        fontLink.rel = "stylesheet";
        fontLink.href = "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400;1,700&display=swap";
        document.head.appendChild(fontLink);
    }

    /* ---------- Apply settings ---------- */

    function apply() {
        var root = document.documentElement;
        root.style.fontSize = prefs.text === 100 ? "" : prefs.text + "%";
        root.classList.toggle("vt-contrast", prefs.contrast);
        root.classList.toggle("vt-readable", prefs.readable);
        root.classList.toggle("vt-motion", prefs.motion);
        root.classList.toggle("vt-links", prefs.links);
        if (prefs.readable) ensureFont();
        if (!root.getAttribute("lang")) root.setAttribute("lang", "en");
        syncDictation();
        render();
    }

    /* ---------- Speak instead of type ---------- */

    function recognizer() {
        return window.SpeechRecognition || window.webkitSpeechRecognition || null;
    }

    var dictation = new WeakMap();
    var observer = null;

    function addMic(ta) {
        if (dictation.has(ta) || ta.readOnly || ta.disabled) return;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "vt-dictate";
        btn.setAttribute("aria-pressed", "false");
        btn.textContent = "🎤 Speak instead of typing";
        var rec = null;

        btn.addEventListener("click", function () {
            if (rec) { rec.stop(); return; }
            var R = recognizer();
            if (!R) return;
            rec = new R();
            rec.lang = document.documentElement.lang || "en-US";
            rec.continuous = true;
            rec.interimResults = false;
            rec.onresult = function (e) {
                for (var i = e.resultIndex; i < e.results.length; i++) {
                    if (!e.results[i].isFinal) continue;
                    var words = e.results[i][0].transcript.trim();
                    if (!words) continue;
                    ta.value = (ta.value && !/\s$/.test(ta.value) ? ta.value + " " : ta.value) + words;
                    ta.dispatchEvent(new Event("input", { bubbles: true }));
                }
            };
            var done = function () {
                rec = null;
                btn.setAttribute("aria-pressed", "false");
                btn.textContent = "🎤 Speak instead of typing";
            };
            rec.onend = done;
            rec.onerror = done;
            rec.start();
            btn.setAttribute("aria-pressed", "true");
            btn.textContent = "⏹ Stop talking";
        });

        ta.insertAdjacentElement("afterend", btn);
        dictation.set(ta, btn);
    }

    function syncDictation() {
        var on = prefs.dictate && !!recognizer();
        if (on) {
            document.querySelectorAll("textarea").forEach(addMic);
            if (!observer && window.MutationObserver) {
                observer = new MutationObserver(function () {
                    document.querySelectorAll("textarea").forEach(addMic);
                });
                observer.observe(document.body, { childList: true, subtree: true });
            }
        } else {
            if (observer) { observer.disconnect(); observer = null; }
            document.querySelectorAll("textarea").forEach(function (ta) {
                var b = dictation.get(ta);
                if (b) { b.remove(); dictation.delete(ta); }
            });
        }
    }

    /* ---------- Panel ---------- */

    var btn, panel;

    function toggleRow(name, title, hint) {
        var pressed = !!prefs[name];
        return '<button type="button" class="vt-toggle" data-pref="' + name + '" aria-pressed="' + pressed + '">' +
            "<span>" + title + (hint ? "<small>" + hint + "</small>" : "") + "</span>" +
            '<span class="vt-pill">' + (pressed ? "On" : "Off") + "</span></button>";
    }

    function render() {
        if (!panel) return;
        var idx = TEXT_STEPS.indexOf(prefs.text);
        var html =
            '<h2><span>Accessibility</span><button type="button" class="vt-close" data-act="close" aria-label="Close accessibility settings">×</button></h2>' +
            "<h3>Text size</h3>" +
            '<div class="vt-row">' +
            '<button type="button" class="vt-step" data-act="smaller" aria-label="Make text smaller"' + (idx <= 0 ? " disabled" : "") + ">A−</button>" +
            '<span class="vt-size" aria-live="polite">' + prefs.text + "%</span>" +
            '<button type="button" class="vt-step" data-act="larger" aria-label="Make text larger"' + (idx >= TEXT_STEPS.length - 1 ? " disabled" : "") + ">A+</button>" +
            "</div>" +
            "<h3>Display</h3>" +
            toggleRow("contrast", "High contrast", "Black text, strong borders and focus") +
            toggleRow("readable", "Readable font", "Atkinson Hyperlegible, made for low vision") +
            toggleRow("links", "Underline links") +
            toggleRow("motion", "Reduce motion", "Turns off animations") +
            (recognizer() ? "<h3>Writing</h3>" + toggleRow("dictate", "Speak instead of type", "Adds a microphone to comment boxes") : "") +
            "<h3>Language</h3>" +
            "<p>To read this page in another language, use your browser’s translate: in Chrome or Edge right-click the page and choose <b>Translate to…</b>; in Safari use the <b>aA</b> menu in the address bar. Translation happens in your browser.</p>" +
            '<button type="button" class="vt-reset" data-act="reset">Reset to defaults</button>';
        panel.innerHTML = html;
    }

    function setOpen(open) {
        panel.hidden = !open;
        btn.setAttribute("aria-expanded", String(open));
        if (open) {
            var first = panel.querySelector("button:not([disabled])");
            if (first) first.focus();
        } else {
            btn.focus();
        }
    }

    function build() {
        btn = document.createElement("button");
        btn.id = "vt-a11y-btn";
        btn.type = "button";
        btn.setAttribute("aria-label", "Accessibility settings");
        btn.setAttribute("aria-haspopup", "dialog");
        btn.setAttribute("aria-expanded", "false");
        btn.title = "Accessibility settings";
        btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm8 6.5v2l-5 .8V22h-2v-6h-2v6H9V11.3l-5-.8v-2l8 1.2 8-1.2z"/></svg>';

        panel = document.createElement("div");
        panel.id = "vt-a11y-panel";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "Accessibility settings");
        panel.hidden = true;

        btn.addEventListener("click", function () { setOpen(panel.hidden); });

        panel.addEventListener("click", function (e) {
            var t = e.target.closest("button");
            if (!t) return;
            var idx = TEXT_STEPS.indexOf(prefs.text);
            var act = t.getAttribute("data-act");
            var pref = t.getAttribute("data-pref");
            if (pref) {
                prefs[pref] = !prefs[pref];
            } else if (act === "larger") {
                prefs.text = TEXT_STEPS[Math.min(TEXT_STEPS.length - 1, idx + 1)];
            } else if (act === "smaller") {
                prefs.text = TEXT_STEPS[Math.max(0, idx - 1)];
            } else if (act === "reset") {
                prefs = Object.assign({}, DEFAULTS);
            } else if (act === "close") {
                return setOpen(false);
            } else {
                return;
            }
            save();
            var focusSel = pref ? '[data-pref="' + pref + '"]' : (act ? '[data-act="' + act + '"]' : null);
            apply();
            var again = focusSel && panel.querySelector(focusSel + ":not([disabled])");
            if (again) again.focus();
        });

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && !panel.hidden) setOpen(false);
        });

        document.body.appendChild(btn);
        document.body.appendChild(panel);
        render();
    }

    // Apply saved settings immediately (before paint) so pages don't flash.
    var root = document.documentElement;
    root.style.fontSize = prefs.text === 100 ? "" : prefs.text + "%";
    root.classList.toggle("vt-contrast", prefs.contrast);
    root.classList.toggle("vt-readable", prefs.readable);
    root.classList.toggle("vt-motion", prefs.motion);
    root.classList.toggle("vt-links", prefs.links);

    function start() {
        build();
        apply();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
})();
