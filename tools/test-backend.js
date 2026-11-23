#!/usr/bin/env node
/**
 * Offline test of the self-updating backend (loader + bundle) against an
 * in-memory fake of Apps Script. No network, no real Sheet, test data only.
 *
 *   node tools/test-backend.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SITE = "https://test.invalid/site/";

let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (!cond && extra ? "  -> " + extra : ""));
  if (!cond) failures++;
}

/* ---------- fake Apps Script ---------- */

class Sheet {
  constructor(name) { this.name = name; this.rows = []; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  appendRow(r) { this.rows.push(r.slice()); }
  deleteRow(n) { this.rows.splice(n - 1, 1); }
  insertColumnAfter(c) { this.rows.forEach(r => r.splice(c, 0, "")); }
  getDataRange() { return this.getRange(1, 1, this.rows.length, this.getLastColumn()); }
  getRange(r, c, nr, nc) {
    const s = this; nr = nr || 1; nc = nc || 1;
    return {
      getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (s.rows[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? "" : v); } o.push(row); } return o; },
      setValue(v) { while (s.rows.length < r) s.rows.push([]); s.rows[r - 1][c - 1] = v; },
      setValues(vs) { vs.forEach((vr, i) => vr.forEach((v, j) => { while (s.rows.length < r + i) s.rows.push([]); s.rows[r - 1 + i][c - 1 + j] = v; })); },
      setNumberFormat() {}
    };
  }
}

function makeEnv(files) {
  const sheets = {};
  const props = {};
  const sent = [];
  const env = { files, fetchLog: [], failFetch: false, sheets, props, sent };

  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = new Sheet(n)),
    getName: () => "Test School Tracker",
    getUrl: () => "https://sheet.invalid/"
  };

  const text = (s) => ({ _s: s, setMimeType() { return this; }, getContent() { return this._s; } });

  const ctx = {
    console,
    Logger: { log() {} },
    ContentService: { createTextOutput: text, MimeType: { JSON: "json" } },
    SpreadsheetApp: {
      getActive: () => ss, getActiveSpreadsheet: () => ss,
      getUi: () => ({ createMenu() { const m = { addItem() { return m; }, addSeparator() { return m; }, addToUi() {} }; return m; } })
    },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this; } }) },
    MailApp: { sendEmail(m) { sent.push(m); } },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => Object.assign({}, props),
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { check9k(v); props[k] = String(v); },
        setProperties: (o) => { Object.keys(o).forEach(k => { check9k(o[k]); props[k] = String(o[k]); }); },
        deleteProperty: k => { delete props[k]; }
      })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest: (alg, s) => Array.from(crypto.createHash("sha256").update(String(s), "utf8").digest()).map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID()
    },
    UrlFetchApp: {
      fetch(url) {
        env.fetchLog.push(url);
        if (env.failFetch) throw new Error("network down");
        const rel = url.replace(SITE, "").split("?")[0];
        if (url.indexOf(SITE) !== 0 || !(rel in env.files)) return { getResponseCode: () => 404, getContentText: () => "" };
        return { getResponseCode: () => 200, getContentText: () => env.files[rel] };
      }
    }
  };
  function check9k(v) { if (Buffer.byteLength(String(v), "utf8") > 9000) throw new Error("Property value too large"); }

  vm.createContext(ctx);
  env.ctx = ctx;
  env.load = (loaderSrc) => vm.runInContext(loaderSrc, ctx);
  env.call = (expr) => vm.runInContext(expr, ctx);
  env.post = (body) => JSON.parse(env.call("doPost")({ postData: { contents: JSON.stringify(body) } }).getContent());
  env.get = () => JSON.parse(env.call("doGet")({}).getContent());
  return env;
}

/* ---------- build two releases into temp dirs ---------- */

function build(tag, release) {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "vtb-src-" + tag + "-"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "vtb-out-" + tag + "-"));
  let code = fs.readFileSync(path.join(ROOT, "backend", "Code.gs"), "utf8");
  code = code.replace(/^const VT_RELEASE = "[^"]+";/m, `const VT_RELEASE = "${release}";`);
  fs.writeFileSync(path.join(src, "Code.gs"), code);
  const notes = JSON.parse(fs.readFileSync(path.join(ROOT, "backend", "notes.json"), "utf8"));
  notes.version = release; notes.notes = "Test release " + release;
  fs.writeFileSync(path.join(src, "notes.json"), JSON.stringify(notes));
  execFileSync("node", [path.join(ROOT, "tools", "build-backend.js")], {
    env: Object.assign({}, process.env, { SRC_DIR: src, OUT_DIR: out, SITE }), stdio: "pipe"
  });
  const read = f => fs.readFileSync(path.join(out, f), "utf8");
  return { bundle: read("bundle.js"), version: read("version.json"), loader: read("Loader.gs") };
}

const v1 = build("a", "3.1.0");
const v2 = build("b", "3.1.1");

function site(rel) { return { "backend/version.json": rel.version, "backend/bundle.js": rel.bundle }; }

/* ---------- tests ---------- */

console.log("Fresh install");
const env = makeEnv(site(v1));
env.load(v1.loader);

env.failFetch = true;
check("before install, with no network, doGet reports an error (not a crash)", env.get().status === "error");
env.failFetch = false;

env.call("vtbInstallNow")();
check("vtbInstallNow installs 3.1.0", env.get().release === "3.1.0");
check("doGet is online and API v3", env.get().status === "online" && env.get().apiVersion === 3);

// Seed test data and the first admin through the sidebar path.
const admin = env.call("uiCreateFirstAdmin")("Test Admin", "admin@example.test");
check("uiCreateFirstAdmin works through the delegate", /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(admin.code), JSON.stringify(admin));
check("admin code was emailed", env.sent.length === 1);
env.post({ action: "addStudent", code: admin.code, name: "Test Student", grade: "9" });
const stu = env.post({ action: "adminBootstrap", code: admin.code }).students;
check("admin routes work (add + read student)", stu.length === 1 && stu[0].name === "Test Student");
const token = env.post({ action: "verifyAdmin", code: admin.code }).entryToken;
env.post({ action: "addEntry", token, date: "2026-11-23", student_id: stu[0].student_id, job_site: "Library", evaluator: "T", scores: { "task:Shelving": 3 } });
check("entry saved with entry token", env.sheets["Entries"].rows.length === 2);

console.log("Update status and auth");
let st = env.post({ action: "updateStatus", code: admin.code });
check("updateStatus works for an admin", st.status === "success" && st.update.installed === "3.1.0");
check("no update offered when current", st.update.updateAvailable === false);
check("non-admin code is denied", env.post({ action: "updateStatus", code: "nope" }).code === "denied");
check("installUpdate denied without admin code", env.post({ action: "installUpdate", code: "nope", expectVersion: "3.1.1" }).code === "denied");
check("undo with nothing stored is refused", env.post({ action: "undoUpdate", code: admin.code }).status === "error");

console.log("Publish 3.1.1, then update");
env.files = site(v2);
st = env.post({ action: "updateStatus", code: admin.code });
check("update is flagged", st.update.updateAvailable === true && st.update.latest.version === "3.1.1");
check("running version unchanged until clicked", env.get().release === "3.1.0");

const wrong = env.post({ action: "installUpdate", code: admin.code, expectVersion: "9.9.9" });
check("installUpdate refuses a version the admin did not review", wrong.status === "error" && wrong.code === "changed");

const inst = env.post({ action: "installUpdate", code: admin.code, expectVersion: "3.1.1" });
check("installUpdate succeeds", inst.status === "success" && inst.installed.version === "3.1.1", JSON.stringify(inst));
check("now running 3.1.1", env.get().release === "3.1.1");
check("old version kept for undo", inst.update.previous === "3.1.0" && inst.update.canUndo === true);
check("student data untouched", env.post({ action: "adminBootstrap", code: admin.code }).students.length === 1 && env.sheets["Entries"].rows.length === 2);
check("admin code still works after update", env.post({ action: "verifyAdmin", code: admin.code }).status === "success");

console.log("Undo and redo");
const und = env.post({ action: "undoUpdate", code: admin.code });
check("undo returns to 3.1.0", und.status === "success" && env.get().release === "3.1.0");
check("undone release is not nagged about again", und.update.updateAvailable === false && und.update.undone === "3.1.1");
const redo = env.post({ action: "undoUpdate", code: admin.code });
check("second undo redoes 3.1.1", redo.status === "success" && env.get().release === "3.1.1" && redo.update.undone === "");
env.post({ action: "undoUpdate", code: admin.code });

console.log("Unsafe downloads are refused");
const v3 = build("c", "3.1.2");

env.files = site(v3);
env.files["backend/bundle.js"] = v3.bundle.replace("Backend Online", "Backend Hacked");
let before = env.get().release;
let bad = env.post({ action: "installUpdate", code: admin.code, expectVersion: "3.1.2" });
check("tampered bundle (hash mismatch) is refused", bad.status === "error" && /fingerprint/.test(bad.message), JSON.stringify(bad));
check("...and nothing changed", env.get().release === before);

// Correct hash but the code does not run.
const broken = v3.bundle.replace("return {", "return {{");
const brokenVersion = JSON.parse(v3.version); brokenVersion.sha256 = crypto.createHash("sha256").update(broken).digest("hex");
env.files = { "backend/version.json": JSON.stringify(brokenVersion), "backend/bundle.js": broken };
bad = env.post({ action: "installUpdate", code: admin.code, expectVersion: "3.1.2" });
check("code that does not compile is refused", bad.status === "error", JSON.stringify(bad));
check("...and nothing changed", env.get().release === before);

// Correct hash, compiles, but its liveness check fails.
const dead = v3.bundle.replace('status: "online"', 'status: "broken"');
const deadVersion = JSON.parse(v3.version); deadVersion.sha256 = crypto.createHash("sha256").update(dead).digest("hex");
env.files = { "backend/version.json": JSON.stringify(deadVersion), "backend/bundle.js": dead };
bad = env.post({ action: "installUpdate", code: admin.code, expectVersion: "3.1.2" });
check("a backend that fails the liveness check is refused", bad.status === "error" && /start on this Sheet/.test(bad.message), JSON.stringify(bad));

// Needs a newer loader.
const needy = JSON.parse(v3.version); needy.minLoader = 99;
env.files = { "backend/version.json": JSON.stringify(needy), "backend/bundle.js": v3.bundle };
bad = env.post({ action: "installUpdate", code: admin.code, expectVersion: "3.1.2" });
check("a release that needs a newer loader is refused with a clear message", bad.status === "error" && /newer loader/.test(bad.message), JSON.stringify(bad));

// Website unreachable.
env.failFetch = true;
st = env.post({ action: "updateStatus", code: admin.code });
check("website down: status still answers, with the error and no update", st.status === "success" && st.update.latestError && st.update.updateAvailable === false);
check("website down: tracker keeps working", env.get().status === "online");
env.failFetch = false;

console.log("Resilience");
// Damage the current copy: the loader must fall back to the previous one, never run damaged code.
env.files = site(v2);
env.post({ action: "installUpdate", code: admin.code, expectVersion: "3.1.1" });
const key = Object.keys(env.props).find(k => /^VTB_CUR_0$/.test(k));
env.props[key] = env.props[key] + "// corrupted";
const env2 = makeEnv(env.files);
Object.assign(env2.props, env.props);
Object.assign(env2.sheets, env.sheets);
env2.load(v1.loader);
check("damaged current copy falls back to the previous version", env2.get().release === "3.1.0", JSON.stringify(env2.get()));

const maxProp = Math.max(...Object.values(env.props).map(v => Buffer.byteLength(v)));
const total = Object.values(env.props).reduce((n, v) => n + Buffer.byteLength(v), 0);
check(`every stored value is under 9 KB (largest ${maxProp} B)`, maxProp < 9000);
check(`two stored copies fit the 500 KB property quota (using ${Math.round(total / 1024)} KB)`, total < 450 * 1024);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
