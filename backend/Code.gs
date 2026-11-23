const VT_API_VERSION = 3;
const VT_SCHEMA_VERSION = 3;
const VT_RELEASE = "3.1.0";

/************************************************************
 * VOCATIONAL TRACKER BACKEND
 *
 * SECURITY MODEL
 * ----------------------------------------------------------
 * This web app is deployed:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Because every web request runs with the spreadsheet owner's
 * permissions, the spreadsheet sharing settings DO NOT protect
 * the web routes. Every route that touches data must authorize
 * the request in this file.
 *
 * Credentials:
 *
 * 1) entry_token
 *    - Stored in Settings.
 *    - Embedded in the job-site QR/link.
 *    - Can read entry-form dropdown data and submit evaluations.
 *    - Cannot read reports or perform admin actions.
 *
 * 2) viewer code
 *    - Viewers columns: name | email | code | active.
 *    - Stored in plaintext because spreadsheet editors already have
 *      more access than Reports grants.
 *    - Can read reports only.
 *
 * 3) admin code
 *    - Admins columns: name | email | code_hash | active.
 *    - One code per administrator.
 *    - Only a SHA-256 hash is stored in Admins.
 *    - Can perform admin actions.
 *    - AUTOMATICALLY INHERITS REPORT ACCESS.
 *
 * 4) break-glass recovery code
 *    - Optional emergency credential stored only as recovery_hash.
 *    - It is never created automatically.
 *
 * LEGACY ADMIN CREDENTIALS
 *    - Old password / password_hash settings are NOT valid web
 *      credentials in v3.
 *    - They are kept only long enough for an existing school to open
 *      the spreadsheet and create its first personal administrator.
 *    - The first personal admin creation permanently retires them.
 *
 * IMPORTANT:
 * ui* functions are for google.script.run from Sidebar.html only.
 * NEVER add them to doPost().
 ************************************************************/


/************************************************************
 * JSON HELPERS
 ************************************************************/

function jsonReply(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function denied(msg) {
  return jsonReply({
    status: "error",
    code: "denied",
    apiVersion: VT_API_VERSION,
    message: msg || "Access denied."
  });
}

function okReply(extra) {
  var out = {
    status: "success",
    apiVersion: VT_API_VERSION
  };
  extra = extra || {};

  Object.keys(extra).forEach(function (key) {
    out[key] = extra[key];
  });

  return jsonReply(out);
}


/************************************************************
 * SPREADSHEET MENU + AUTOMATIC INITIALIZATION
 ************************************************************/

/**
 * Runs whenever an editor opens the bound spreadsheet.
 *
 * The initializer is idempotent: it creates only missing sheets,
 * settings, and headers. Existing student and evaluation data is
 * never replaced.
 */
function onOpen(e) {
  try {
    ensureInstanceReady_();
  } catch (err) {
    console.error("Vocational Tracker initialization failed:", err);
  }

  SpreadsheetApp.getUi()
    .createMenu("Vocational Tracker")
    .addItem("Setup & Credentials", "showSetupSidebar")
    .addSeparator()
    .addItem("Repair / Check Setup", "initialSetup")
    .addToUi();
}


/**
 * Manual compatibility entry point.
 * New installations should not need to run this from Apps Script.
 */
function initialSetup() {
  ensureInstanceReady_();

  Logger.log("Vocational Tracker setup/repair complete.");
  Logger.log("Spreadsheet: " + SpreadsheetApp.getActiveSpreadsheet().getName());
  Logger.log("Entry token present: " + (getSetting("entry_token") ? "YES" : "NO"));
  Logger.log("Active admins: " + countActiveAdmins_());
  Logger.log("Open Vocational Tracker > Setup & Credentials in the spreadsheet.");
}


/**
 * Creates or repairs the tracker structure without replacing
 * existing data.
 */
function ensureInstanceReady_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureSheet_(ss, "Students",
    ["student_id", "name", "grade", "active"]);

  ensureSheet_(ss, "Entries",
    ["entry_id", "date", "student_id", "job_site",
     "evaluator", "comments", "scores_json"]);

  ensureSheet_(ss, "Settings",
    ["key", "value"]);

  // Capture the pre-v3 schema before any migration writes occur.
  var priorSchema = parseInt(getSetting("schema_version") || "0", 10);
  if (isNaN(priorSchema)) priorSchema = 0;

  var sites = ensureSheet_(ss, "Sites", ["site_name"]);
  if (sites.created) {
    sites.sheet.appendRow(["Cafeteria"]);
    sites.sheet.appendRow(["Library"]);
    sites.sheet.appendRow(["Front Office"]);
  }

  ensureSheet_(ss, "Tasks",
    ["site_name", "task_name"]);

  ensureSheet_(ss, "Feature Requests",
    ["request_id", "submitted_at", "submitted_by", "submitted_email",
     "category", "title", "details", "status"]);

  // Access sheets include email in v3. Existing 3-column sheets are
  // migrated by inserting an email column while preserving credentials.
  ensureAccessSheet_(ss, "Viewers", "code");
  ensureAccessSheet_(ss, "Admins", "code_hash");

  // V3 is a deliberate security boundary. On the first v3 migration,
  // rotate the entry token so every pre-v3 QR and saved entry link dies.
  // This happens exactly once because schema_version is written below.
  if (priorSchema < VT_SCHEMA_VERSION) {
    setSetting("entry_token", Utilities.getUuid());
    setSetting("v3_entry_rotated_at", new Date().toISOString());
    setSetting("migrated_from_schema", String(priorSchema));
  } else if (!getSetting("entry_token")) {
    setSetting("entry_token", Utilities.getUuid());
  }

  // Old public setup-claim flow is permanently retired.
  removeSetting_("setup_claim");

  // Once a personal admin exists, legacy shared credentials are removed.
  if (countActiveAdmins_() > 0) {
    retireLegacyAdminCredentials_();
  }

  setSetting("schema_version", String(VT_SCHEMA_VERSION));
  setSetting("release_version", VT_RELEASE);
}


function getSchemaVersion_() {
  var n = parseInt(getSetting("schema_version") || "0", 10);
  return isNaN(n) ? 0 : n;
}


function hasLegacyAdminCredential_() {
  return !!getSetting("password") || !!getSetting("password_hash");
}


function retireLegacyAdminCredentials_() {
  var hadLegacy = hasLegacyAdminCredential_();

  removeSetting_("password");
  removeSetting_("password_hash");

  if (hadLegacy) {
    setSetting("legacy_admin_retired_at", new Date().toISOString());
  }
}


function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  var created = false;

  if (!sheet) {
    sheet = ss.insertSheet(name);
    created = true;
  }

  // A truly blank sheet gets the expected header row.
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }

  return {
    sheet: sheet,
    created: created
  };
}


/**
 * Ensures an access-control sheet has the current schema:
 *
 *   Viewers: name | email | code      | active
 *   Admins:  name | email | code_hash | active
 *
 * Older installations used three columns:
 *   name | code/code_hash | active
 *
 * Migration inserts a new email column B, preserving every existing
 * credential and active flag.
 */
function ensureAccessSheet_(ss, name, credentialHeader) {
  var sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(["name", "email", credentialHeader, "active"]);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["name", "email", credentialHeader, "active"]);
    return sheet;
  }

  var lastCol = Math.max(sheet.getLastColumn(), 3);
  var headers = sheet
    .getRange(1, 1, 1, lastCol)
    .getValues()[0]
    .map(function (h) {
      return String(h || "").trim().toLowerCase();
    });

  var nameIndex = headers.indexOf("name");
  var emailIndex = headers.indexOf("email");
  var credentialIndex = headers.indexOf(credentialHeader);
  var activeIndex = headers.indexOf("active");

  // Known legacy shape: name | credential | active
  if (emailIndex === -1 &&
      nameIndex === 0 &&
      credentialIndex === 1 &&
      activeIndex === 2) {
    sheet.insertColumnAfter(1);
    sheet.getRange(1, 2).setValue("email");
    return sheet;
  }

  // If the sheet only contains the header row but its headers are damaged,
  // repair the header safely because there is no user data to shift.
  if (sheet.getLastRow() === 1 &&
      (nameIndex === -1 || credentialIndex === -1 || activeIndex === -1)) {
    sheet.getRange(1, 1, 1, 4)
      .setValues([["name", "email", credentialHeader, "active"]]);
  }

  return sheet;
}


/**
 * Resolves columns by header, with fallback support for older 3-column
 * access sheets that have not yet been opened/migrated.
 *
 * Returned indexes are zero-based.
 */
function accessColumns_(sheet, credentialHeader) {
  var lastCol = Math.max(sheet.getLastColumn(), 3);
  var headers = sheet
    .getRange(1, 1, 1, lastCol)
    .getValues()[0]
    .map(function (h) {
      return String(h || "").trim().toLowerCase();
    });

  var name = headers.indexOf("name");
  var email = headers.indexOf("email");
  var credential = headers.indexOf(credentialHeader);
  var active = headers.indexOf("active");

  // Fallback for the old three-column layout.
  if (credential === -1 && lastCol >= 3) {
    name = 0;
    email = -1;
    credential = 1;
    active = 2;
  }

  return {
    name: name,
    email: email,
    credential: credential,
    active: active
  };
}


function readAccessRows_(sheetName, credentialHeader) {
  var sh = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];

  var cols = accessColumns_(sh, credentialHeader);
  var rows = sh.getDataRange().getValues();
  var list = [];

  for (var i = 1; i < rows.length; i++) {
    var credential = cols.credential >= 0
      ? String(rows[i][cols.credential] || "").trim()
      : "";

    var name = cols.name >= 0
      ? normalizedName_(rows[i][cols.name])
      : "";

    if (!name && !credential) continue;

    list.push({
      row: i + 1,
      name: name,
      email: cols.email >= 0
        ? String(rows[i][cols.email] || "").trim()
        : "",
      credential: credential,
      active: cols.active >= 0
        ? rowIsActive_(rows[i][cols.active])
        : true,
      activeColumn: cols.active + 1,
      emailColumn: cols.email + 1,
      credentialColumn: cols.credential + 1
    });
  }

  return list;
}


/************************************************************
 * SIDEBAR
 ************************************************************/

function showSetupSidebar() {
  ensureInstanceReady_();

  var html = HtmlService
    .createHtmlOutputFromFile("Sidebar")
    .setTitle("Vocational Tracker");

  SpreadsheetApp.getUi().showSidebar(html);
}


/************************************************************
 * SETTINGS
 ************************************************************/

function getSetting(key) {
  var sh = SpreadsheetApp.getActive().getSheetByName("Settings");
  if (!sh || sh.getLastRow() === 0) return "";

  var rows = sh.getDataRange().getValues();
  var needle = String(key || "").trim().toLowerCase();

  for (var i = 0; i < rows.length; i++) {
    var current = String(rows[i][0] || "").trim().toLowerCase();

    // "admin password" compatibility from older instances.
    if (current === needle || current === "admin " + needle) {
      return String(rows[i][1] || "").trim();
    }
  }

  return "";
}


function setSetting(key, value) {
  var sh = SpreadsheetApp.getActive().getSheetByName("Settings");

  if (!sh) {
    sh = SpreadsheetApp.getActive().insertSheet("Settings");
    sh.appendRow(["key", "value"]);
  }

  var rows = sh.getDataRange().getValues();
  var needle = String(key || "").trim().toLowerCase();

  for (var i = 0; i < rows.length; i++) {
    var current = String(rows[i][0] || "").trim().toLowerCase();

    if (current === needle) {
      sh.getRange(i + 1, 2).setValue(value);
      return;
    }
  }

  sh.appendRow([key, value]);
}


function removeSetting_(key) {
  var sh = SpreadsheetApp.getActive().getSheetByName("Settings");
  if (!sh || sh.getLastRow() === 0) return;

  var rows = sh.getDataRange().getValues();
  var needle = String(key || "").trim().toLowerCase();

  for (var i = rows.length - 1; i >= 0; i--) {
    var current = String(rows[i][0] || "").trim().toLowerCase();

    if (current === needle || current === "admin " + needle) {
      sh.deleteRow(i + 1);
    }
  }
}


/************************************************************
 * HASHING + RANDOM CODES
 ************************************************************/

/**
 * Exact text hash.
 * Used for the legacy/break-glass password because older passwords
 * may have been case-sensitive.
 */
function hashText_(value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ""),
    Utilities.Charset.UTF_8
  );

  return bytes.map(function (b) {
    var v = b;
    if (v < 0) v += 256;
    return ("0" + v.toString(16)).slice(-2);
  }).join("");
}


/**
 * Personal admin codes are normalized so phone auto-capitalization
 * does not break login.
 */
function hashAdminCode_(code) {
  return hashText_(String(code || "").trim().toLowerCase());
}


/**
 * Readable credential generator.
 * Produces values such as: 7mrx-k3fa-h8wp
 */
function randomCode(groups, charsPerGroup) {
  groups = groups || 3;
  charsPerGroup = charsPerGroup || 4;

  // Avoid characters that are easy to confuse when retyping.
  var alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  var needed = groups * charsPerGroup;
  var raw = "";

  // UUIDs give us a convenient source of random hex characters.
  while (raw.length < needed * 2) {
    raw += Utilities.getUuid().replace(/-/g, "");
  }

  var out = "";
  for (var i = 0; i < needed; i++) {
    var pair = raw.substr(i * 2, 2);
    var n = parseInt(pair, 16);
    out += alphabet.charAt(n % alphabet.length);
  }

  var pieces = [];
  for (var j = 0; j < groups; j++) {
    pieces.push(out.substr(j * charsPerGroup, charsPerGroup));
  }

  return pieces.join("-");
}


/************************************************************
 * BOOLEAN / ROW HELPERS
 ************************************************************/

function rowIsActive_(value) {
  if (value === false) return false;

  var s = String(value === undefined || value === null ? "" : value)
    .trim()
    .toLowerCase();

  return !(s === "false" || s === "no" || s === "0" || s === "inactive");
}


function normalizedName_(value) {
  return String(value || "").trim();
}


function normalizedEmail_(value) {
  return String(value || "").trim().toLowerCase();
}


function validEmail_(value) {
  var email = normalizedEmail_(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}


/**
 * Emails a credential without ever storing an admin's plaintext code.
 *
 * A failure to send mail does NOT invalidate the credential creation.
 * The sidebar still reveals the code once so the administrator can
 * deliver it another way.
 */
function sendAccessEmail_(email, name, code, role) {
  email = normalizedEmail_(email);

  if (!email) {
    return {
      emailSent: false,
      emailError: "No email address is set."
    };
  }

  if (!validEmail_(email)) {
    return {
      emailSent: false,
      emailError: "The saved email address is not valid."
    };
  }

  var trackerName = SpreadsheetApp.getActiveSpreadsheet().getName();
  var isAdmin = role === "admin";
  var roleLabel = isAdmin
    ? "Administrator access (including Reports)"
    : "Reports access";

  var subject = isAdmin
    ? "Your Vocational Tracker administrator code"
    : "Your Vocational Tracker report access code";

  var plain =
    "Hi " + name + ",\n\n" +
    "You have been given " + roleLabel + " for " + trackerName + ".\n\n" +
    "Your personal access code is:\n\n" +
    code + "\n\n" +
    "Keep this code private. If you lose it, contact a Vocational Tracker administrator.\n\n" +
    "Vocational Tracker";

  var html =
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.5">' +
      '<h2 style="color:#1e3a8a;margin-bottom:8px">Vocational Tracker</h2>' +
      '<p>Hi ' + escapeHtmlForEmail_(name) + ',</p>' +
      '<p>You have been given <strong>' + escapeHtmlForEmail_(roleLabel) +
        '</strong> for <strong>' + escapeHtmlForEmail_(trackerName) + '</strong>.</p>' +
      '<p>Your personal access code is:</p>' +
      '<div style="font-family:Consolas,monospace;font-size:22px;font-weight:700;' +
        'letter-spacing:.04em;padding:14px;border:1px solid #93c5fd;background:#eff6ff;' +
        'border-radius:8px;text-align:center;color:#111827">' +
        escapeHtmlForEmail_(code) +
      '</div>' +
      '<p style="margin-top:16px">Keep this code private. If you lose it, contact a ' +
        'Vocational Tracker administrator.</p>' +
      '<p style="color:#6b7280;font-size:12px">This message contains an access credential. ' +
        'It does not contain student information.</p>' +
    '</div>';

  try {
    MailApp.sendEmail({
      to: email,
      subject: subject,
      body: plain,
      htmlBody: html,
      name: "Vocational Tracker"
    });

    return {
      emailSent: true,
      emailError: ""
    };

  } catch (err) {
    return {
      emailSent: false,
      emailError: err && err.message ? err.message : String(err)
    };
  }
}


function escapeHtmlForEmail_(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function credentialResult_(code, email, mailResult) {
  mailResult = mailResult || {
    emailSent: false,
    emailError: "Email was not attempted."
  };

  return {
    code: code,
    email: normalizedEmail_(email),
    emailSent: !!mailResult.emailSent,
    emailError: mailResult.emailError || ""
  };
}


function normalizeSiteBaseUrl_(value) {
  var url = String(value || "").trim();
  if (!url) return "";

  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }

  url = url.replace(
    /\/(?:index|entry|report|admin|faq|setup)\.html(?:[?#].*)?$/i,
    "/"
  );

  if (!/\/$/.test(url)) url += "/";
  return url;
}


function savePublicSiteSettings_(baseUrl, supportEmail) {
  var base = normalizeSiteBaseUrl_(baseUrl);
  var email = normalizedEmail_(supportEmail);

  if (base && !/^https?:\/\/[^\/]+/i.test(base)) {
    throw new Error("Enter a valid public website URL.");
  }

  if (email && !validEmail_(email)) {
    throw new Error("Enter a valid support email address.");
  }

  setSetting("public_site_base_url", base);
  setSetting("support_email", email);

  if (base) {
    setSetting("dashboard_url", base + "index.html");
    setSetting("entry_page_url", base + "entry.html");
    setSetting("report_page_url", base + "report.html");
    setSetting("admin_page_url", base + "admin.html");
    setSetting("setup_page_url", base + "setup.html");
    setSetting("help_page_url", base + "faq.html");
  } else {
    removeSetting_("dashboard_url");
    removeSetting_("entry_page_url");
    removeSetting_("report_page_url");
    removeSetting_("admin_page_url");
    removeSetting_("setup_page_url");
    removeSetting_("help_page_url");
  }

  return {
    baseUrl: base,
    supportEmail: email,
    entryUrl: getSetting("entry_page_url")
  };
}


/************************************************************
 * VIEWER AUTHORIZATION
 ************************************************************/

/**
 * Returns viewer identity or null.
 *
 * Viewer codes remain plaintext because anyone who can open the
 * Viewers tab already has direct spreadsheet access.
 */
function lookupViewer_(code) {
  if (!code) return null;

  var needle = String(code).trim().toLowerCase();
  if (!needle) return null;

  var rows = readAccessRows_("Viewers", "code");

  for (var i = 0; i < rows.length; i++) {
    var stored = String(rows[i].credential || "").trim().toLowerCase();

    if (!stored || stored !== needle) continue;
    if (!rows[i].active) return null;

    return {
      name: rows[i].name || "Viewer",
      email: rows[i].email || "",
      role: "viewer",
      id: rows[i].credential
    };
  }

  return null;
}


/************************************************************
 * ADMIN AUTHORIZATION
 ************************************************************/

/**
 * Returns admin identity or null.
 *
 * V3 accepts only:
 *  1. Active per-person Admins rows.
 *  2. An explicitly generated break-glass recovery code.
 *
 * Old shared password/password_hash values are intentionally NOT accepted
 * by web routes. They exist only as migration markers until the first
 * personal administrator is created.
 */
function lookupAdmin_(code) {
  if (!code) return null;

  var raw = String(code).trim();
  if (!raw) return null;

  var normalizedHash = hashAdminCode_(raw);
  var adminRows = readAccessRows_("Admins", "code_hash");

  for (var i = 0; i < adminRows.length; i++) {
    var storedHash = String(adminRows[i].credential || "").trim().toLowerCase();

    if (!storedHash || storedHash !== normalizedHash) continue;
    if (!adminRows[i].active) return null;

    return {
      name: adminRows[i].name || "Administrator",
      email: adminRows[i].email || "",
      role: "admin",
      id: storedHash
    };
  }

  var recoveryHash = String(getSetting("recovery_hash") || "")
    .trim()
    .toLowerCase();

  if (recoveryHash &&
      (hashText_(raw).toLowerCase() === recoveryHash ||
       normalizedHash === recoveryHash)) {
    return {
      name: "Recovery Administrator",
      email: "",
      role: "admin",
      id: "recovery"
    };
  }

  return null;
}


function countActiveAdmins_() {
  var rows = readAccessRows_("Admins", "code_hash");
  var count = 0;

  rows.forEach(function (row) {
    if (row.credential && row.active) count++;
  });

  return count;
}


function adminCredentialExists_() {
  return countActiveAdmins_() > 0 || !!getSetting("recovery_hash");
}


/************************************************************
 * REPORT AUTHORIZATION
 *
 * IMPORTANT NEW RULE:
 * An active administrator automatically inherits report access.
 *
 * There is NO duplicate Viewers row and NO second code.
 ************************************************************/

function lookupReportUser_(code) {
  var viewer = lookupViewer_(code);
  if (viewer) return viewer;

  var admin = lookupAdmin_(code);
  if (admin) {
    return {
      name: admin.name,
      role: "admin",
      id: admin.id
    };
  }

  return null;
}


/************************************************************
 * WEB ROUTING - GET
 *
 * Anonymous liveness check only.
 ************************************************************/

function doGet(e) {
  return jsonReply({
    status: "online",
    message: "Backend Online",
    apiVersion: VT_API_VERSION,
    schemaVersion: getSchemaVersion_(),
    release: VT_RELEASE
  });
}


/************************************************************
 * WEB ROUTING - POST
 *
 * Every data route below performs its own credential check.
 ************************************************************/

function doPost(e) {
  try {
    var d = {};

    if (e && e.postData && e.postData.contents) {
      d = JSON.parse(e.postData.contents);
    }

    switch (d.action) {

      // ENTRY TOKEN
      case "entryBootstrap":
        return entryBootstrap(d);

      case "addEntry":
        return addEntry(d);


      // REPORT VIEWER OR ADMIN
      case "verifyViewer":
        return verifyViewer(d);

      case "getEntries":
        return getEntries(d);


      // ADMIN
      case "verifyAdmin":
        return verifyAdmin(d);

      case "adminBootstrap":
        return adminBootstrap(d);

      case "addStudent":
        return addStudent(d);

      case "updateStudent":
        return updateStudent(d);

      case "deleteStudent":
        return deleteStudent(d);

      case "setStudentActive":
        return setStudentActive(d);

      case "addSite":
        return addSite(d);

      case "deleteSite":
        return deleteSite(d);

      case "addTask":
        return addTask(d);

      case "deleteTask":
        return deleteTask(d);

      case "rotateEntryToken":
        return rotateEntryToken(d);

      case "submitFeatureRequest":
        return submitFeatureRequest(d);

      case "savePublicSiteSettings":
        return savePublicSiteSettingsRoute(d);

        // SHARED REPORT LAYOUTS (3.1.0)
      case "listLayouts":
        return listLayouts(d);

      case "saveLayout":
        return saveLayout(d);

      case "deleteLayout":
        return deleteLayout(d);

      case "setDefaultLayout":
        return setDefaultLayout(d);
    }


    return jsonReply({
      status: "error",
      message: "Unknown action"
    });

  } catch (err) {
    return jsonReply({
      status: "error",
      message: err && err.message ? err.message : String(err)
    });
  }
}


/************************************************************
 * ENTRY TOKEN ROUTES
 ************************************************************/

function entryBootstrap(d) {
  if (!okEntryToken_(d.token)) {
    return denied(
      "This entry link is no longer valid. Ask your coordinator for a new QR code."
    );
  }

  return okReply({
    students: readStudents(),
    sites: readSites(),
    tasks: readTasks()
  });
}


function addEntry(d) {
  if (!okEntryToken_(d.token)) {
    return denied(
      "This entry link is no longer valid. Your entry was NOT saved. Ask your coordinator for a new QR code."
    );
  }

  var sh = SpreadsheetApp.getActive().getSheetByName("Entries");
  if (!sh) {
    return jsonReply({
      status: "error",
      message: "Entries sheet not found."
    });
  }

  var id = "ENT" + new Date().getTime();

  sh.appendRow([
    id,
    d.date || "",
    d.student_id || "",
    d.job_site || "",
    d.evaluator || "",
    d.comments || "",
    JSON.stringify(d.scores || {})
  ]);

  return okReply({ id: id });
}


function okEntryToken_(token) {
  var expected = getSetting("entry_token");
  if (!expected) return false;

  return String(token || "").trim() === expected;
}


/************************************************************
 * REPORT ROUTES
 ************************************************************/

function verifyViewer(d) {
  var user = lookupReportUser_(d.code);

  if (!user) {
    return denied("That access code was not recognized.");
  }

  return okReply({
    viewer: user.name,
    role: user.role,
    schemaVersion: getSchemaVersion_(),
    release: VT_RELEASE
  });
}


function getEntries(d) {
  var user = lookupReportUser_(d.code);

  if (!user) {
    return denied(
      "Your access code is not valid or has been turned off."
    );
  }

  var sh = SpreadsheetApp.getActive().getSheetByName("Entries");
  if (!sh) {
    return jsonReply({
      status: "error",
      message: "Entries sheet not found."
    });
  }

  var rows = sh.getDataRange().getValues();
  if (rows.length) rows.shift();

  var list = rows.map(function (r) {
    var scores = {};

    if (r[6]) {
      try {
        scores = JSON.parse(r[6]);
      } catch (err) {
        scores = {};
      }
    }

    return {
      entry_id: r[0],
      date: (r[1] instanceof Date)
        ? Utilities.formatDate(r[1], SpreadsheetApp.getActive().getSpreadsheetTimeZone(), "yyyy-MM-dd")
        : r[1],
      student_id: r[2],
      job_site: r[3],
      evaluator: r[4],
      comments: r[5],
      scores: scores
    };
  });

  return okReply({
    viewer: user.name,
    role: user.role,
    students: readStudents(),
    tasks: readTasks(),
    data: list
  });
}


/************************************************************
 * ADMIN WEB ROUTES
 ************************************************************/

function requireAdmin_(d) {
  return lookupAdmin_(d.pass || d.code || d.adminCode);
}


function verifyAdmin(d) {
  var admin = requireAdmin_(d);

  if (!admin) {
    return denied("Incorrect or inactive administrator code.");
  }

  return okReply({
    admin: admin.name,
    adminEmail: admin.email || "",
    role: "admin",
    entryToken: getSetting("entry_token"),
    schemaVersion: getSchemaVersion_(),
    release: VT_RELEASE
  });
}


function adminBootstrap(d) {
  var admin = requireAdmin_(d);

  if (!admin) {
    return denied("Incorrect or inactive administrator code.");
  }

  return okReply({
    admin: admin.name,
    adminEmail: admin.email || "",
    students: readStudents(),
    sites: readSites(),
    tasks: readTasks(),
    supportEmail: getSetting("support_email"),
    publicSiteBaseUrl: getSetting("public_site_base_url"),
    entryPageUrl: getSetting("entry_page_url")
  });
}


function addStudent(d) {
  var admin = requireAdmin_(d);
  if (!admin) return denied("Incorrect or inactive administrator code.");

  var name = normalizedName_(d.name);
  if (!name) {
    return jsonReply({
      status: "error",
      message: "Student name is required."
    });
  }

  var sh = SpreadsheetApp.getActive().getSheetByName("Students");
  var id = "STU" + new Date().getTime().toString().slice(-9);

  sh.appendRow([
    id,
    name,
    d.grade || "",
    true
  ]);

  return okReply({
    student_id: id
  });
}


function updateStudent(d) {
  var admin = requireAdmin_(d);
  if (!admin) return denied("Incorrect or inactive administrator code.");

  var sh = SpreadsheetApp.getActive().getSheetByName("Students");
  if (!sh) {
    return jsonReply({
      status: "error",
      message: "Students sheet not found."
    });
  }

  var rows = sh.getDataRange().getValues();

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(d.student_id)) continue;

    if (d.name !== undefined) {
      sh.getRange(i + 1, 2).setValue(normalizedName_(d.name));
    }

    if (d.grade !== undefined) {
      sh.getRange(i + 1, 3).setValue(d.grade);
    }

    if (d.active !== undefined) {
      sh.getRange(i + 1, 4).setValue(!!d.active);
    }

    return okReply({});
  }

  return jsonReply({
    status: "error",
    message: "Student not found."
  });
}


function setStudentActive(d) {
  var admin = requireAdmin_(d);
  if (!admin) return denied("Incorrect or inactive administrator code.");

  var sh = SpreadsheetApp.getActive().getSheetByName("Students");
  if (!sh) {
    return jsonReply({
      status: "error",
      message: "Students sheet not found."
    });
  }

  var rows = sh.getDataRange().getValues();

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(d.student_id)) {
      sh.getRange(i + 1, 4).setValue(!!d.active);
      return okReply({});
    }
  }

  return jsonReply({
    status: "error",
    message: "Student not found."
  });
}


function deleteStudent(d) {
  var admin = requireAdmin_(d);
  if (!admin) return denied("Incorrect or inactive administrator code.");

  var sh = SpreadsheetApp.getActive().getSheetByName("Students");
  if (!sh) {
    return jsonReply({
      status: "error",
      message: "Students sheet not found."
    });
  }

  var rows = sh.getDataRange().getValues();

  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(d.student_id)) {
      sh.deleteRow(i + 1);
      return okReply({});
    }
  }

  return jsonReply({
    status: "error",
    message: "Student not found."
  });
}


function addSite(d) {
  var admin = requireAdmin_(d);
  if (!admin) return denied("Incorrect or inactive administrator code.");

  var siteName = normalizedName_(d.site_name);
  if (!siteName) {
    return jsonReply({
      status: "error",
      message: "Site name is required."
    });
  }

  SpreadsheetApp.getActive()
    .getSheetByName("Sites")
    .appendRow([siteName]);

  return okReply({});
}


function deleteSite(d) {
  var admin = requireAdmin_(d);
  if (!admin) return denied("Incorrect or inactive administrator code.");

  var ss = SpreadsheetApp.getActive();
  var target = String(d.site_name || "");

  var siteSh = ss.getSheetByName("Sites");
  if (siteSh) {
    var siteRows = siteSh.getDataRange().getValues();

    for (var i = siteRows.length - 1; i >= 1; i--) {
      if (String(siteRows[i][0]) === target) {
        siteSh.deleteRow(i + 1);
      }
    }
  }

  // Remove tasks that belong to the deleted site.
  var taskSh = ss.getSheetByName("Tasks");
  if (taskSh) {
    var taskRows = taskSh.getDataRange().getValues();

    for (var j = taskRows.length - 1; j >= 1; j--) {
      if (String(taskRows[j][0]) === target) {
        taskSh.deleteRow(j + 1);
      }
    }
  }

  return okReply({});
}


function addTask(d) {
  var admin = requireAdmin_(d);
  if (!admin) return denied("Incorrect or inactive administrator code.");

  var site = normalizedName_(d.site_name);
  var task = normalizedName_(d.task_name);

  if (!site || !task) {
    return jsonReply({
      status: "error",
      message: "Site and task are required."
    });
  }

  var sh = SpreadsheetApp.getActive().getSheetByName("Tasks");
  if (!sh) {
    return jsonReply({
      status: "error",
      message: "Tasks sheet not found."
    });
  }

  sh.appendRow([site, task]);

  return okReply({});
}


function deleteTask(d) {
  var admin = requireAdmin_(d);
  if (!admin) return denied("Incorrect or inactive administrator code.");

  var sh = SpreadsheetApp.getActive().getSheetByName("Tasks");
  if (!sh) {
    return jsonReply({
      status: "error",
      message: "Tasks sheet not found."
    });
  }

  var rows = sh.getDataRange().getValues();

  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(d.site_name) &&
        String(rows[i][1]) === String(d.task_name)) {
      sh.deleteRow(i + 1);
      return okReply({});
    }
  }

  return jsonReply({
    status: "error",
    message: "Task not found."
  });
}


function rotateEntryToken(d) {
  var admin = requireAdmin_(d);
  if (!admin) return denied("Incorrect or inactive administrator code.");

  var token = Utilities.getUuid();
  setSetting("entry_token", token);

  return okReply({
    entryToken: token
  });
}







function submitFeatureRequest(d) {
  var admin = requireAdmin_(d);
  if (!admin) return denied("Incorrect or inactive administrator code.");

  var category = normalizedName_(d.category) || "General";
  var title = normalizedName_(d.title);
  var details = String(d.details || "").trim();
  var submittedEmail = normalizedEmail_(d.email || admin.email || "");

  if (!title) {
    return jsonReply({
      status: "error",
      apiVersion: VT_API_VERSION,
      message: "Add a short title for the request."
    });
  }

  if (!details) {
    return jsonReply({
      status: "error",
      apiVersion: VT_API_VERSION,
      message: "Describe the requested change."
    });
  }

  var sh = SpreadsheetApp.getActive().getSheetByName("Feature Requests");

  if (!sh) {
    ensureInstanceReady_();
    sh = SpreadsheetApp.getActive().getSheetByName("Feature Requests");
  }

  var id = "FR" + new Date().getTime();

  sh.appendRow([
    id,
    new Date(),
    admin.name || "Administrator",
    submittedEmail,
    category,
    title,
    details,
    "Submitted"
  ]);

  var supportEmail = normalizedEmail_(getSetting("support_email"));
  var emailed = false;
  var emailError = "";

  if (supportEmail && validEmail_(supportEmail)) {
    try {
      var school = SpreadsheetApp.getActiveSpreadsheet().getName();

      MailApp.sendEmail({
        to: supportEmail,
        subject: "Vocational Tracker feature request: " + title,
        body:
          "Vocational Tracker Feature Request\n\n" +
          "School / Tracker: " + school + "\n" +
          "Submitted by: " + (admin.name || "Administrator") + "\n" +
          "Reply email: " + (submittedEmail || "(not provided)") + "\n" +
          "Category: " + category + "\n" +
          "Request ID: " + id + "\n\n" +
          title + "\n\n" +
          details + "\n",
        name: "Vocational Tracker"
      });

      emailed = true;

    } catch (err) {
      emailError = err && err.message ? err.message : String(err);
    }
  }

  return okReply({
    requestId: id,
    emailed: emailed,
    supportEmail: supportEmail,
    emailError: emailError
  });
}


function savePublicSiteSettingsRoute(d) {
  var admin = requireAdmin_(d);
  if (!admin) return denied("Incorrect or inactive administrator code.");

  var supportEmail = d.supportEmail;

  if (supportEmail === undefined || supportEmail === null) {
    supportEmail = getSetting("support_email");
  }

  var saved = savePublicSiteSettings_(d.baseUrl || "", supportEmail || "");

  return okReply({
    publicSiteBaseUrl: saved.baseUrl,
    supportEmail: saved.supportEmail,
    entryPageUrl: saved.entryUrl
  });
}


/************************************************************
 * SHARED DATA READERS
 *
 * These are internal helpers, not web routes.
 ************************************************************/

function readStudents() {
  var sh = SpreadsheetApp.getActive().getSheetByName("Students");
  if (!sh || sh.getLastRow() < 2) return [];

  var rows = sh.getDataRange().getValues();
  rows.shift();

  return rows
    .filter(function (r) {
      return r[0] || r[1];
    })
    .map(function (r) {
      return {
        student_id: r[0],
        name: r[1],
        grade: r[2],
        active: rowIsActive_(r[3])
      };
    });
}


function readSites() {
  var sh = SpreadsheetApp.getActive().getSheetByName("Sites");
  if (!sh || sh.getLastRow() < 2) return [];

  var rows = sh.getDataRange().getValues();
  rows.shift();

  return rows
    .map(function (r) {
      return String(r[0] || "").trim();
    })
    .filter(Boolean)
    .sort();
}


function readTasks() {
  var sh = SpreadsheetApp.getActive().getSheetByName("Tasks");
  if (!sh || sh.getLastRow() < 2) return [];

  var rows = sh.getDataRange().getValues();
  rows.shift();

  return rows
    .filter(function (r) {
      return r[0] && r[1];
    })
    .map(function (r) {
      return {
        site_name: String(r[0]).trim(),
        task_name: String(r[1]).trim()
      };
    });
}


/************************************************************
 * SIDEBAR STATUS
 ************************************************************/

function uiStatus() {
  ensureInstanceReady_();

  return {
    passwordSet: adminCredentialExists_(),
    claim: "",
    entryToken: getSetting("entry_token"),
    viewers: readViewerStatus_(),
    admins: readAdminStatus_(),
    hasAdmins: countActiveAdmins_() > 0,
    legacyAdminPresent: hasLegacyAdminCredential_(),
    recoverySet: !!getSetting("recovery_hash"),
    publicSiteBaseUrl: getSetting("public_site_base_url"),
    entryPageUrl: getSetting("entry_page_url"),
    supportEmail: getSetting("support_email"),
    apiVersion: VT_API_VERSION,
    schemaVersion: getSchemaVersion_(),
    release: VT_RELEASE
  };
}


function readViewerStatus_() {
  return readAccessRows_("Viewers", "code").map(function (row) {
    return {
      name: row.name || "Viewer",
      email: row.email || "",
      code: row.credential,
      id: row.credential,
      active: row.active
    };
  });
}


function readAdminStatus_() {
  return readAccessRows_("Admins", "code_hash").map(function (row) {
    return {
      name: row.name || "Administrator",
      email: row.email || "",
      id: row.credential,
      active: row.active,
      reportAccess: row.active
    };
  });
}


/************************************************************
 * SIDEBAR SETUP
 ************************************************************/

function uiInitialSetup() {
  ensureInstanceReady_();

  return {
    status: "success",
    entryToken: getSetting("entry_token"),
    hasAdmins: countActiveAdmins_() > 0
  };
}


/**
 * New preferred first-admin flow.
 *
 * It is safe because this function is not in doPost(); it is callable
 * through google.script.run only from the spreadsheet-bound sidebar.
 */
function uiCreateFirstAdmin(name, email) {
  ensureInstanceReady_();

  name = normalizedName_(name);
  email = normalizedEmail_(email);

  if (!name) throw new Error("Enter the administrator's name.");
  if (!validEmail_(email)) throw new Error("Enter a valid administrator email address.");

  if (countActiveAdmins_() > 0) {
    throw new Error(
      "This instance already has an administrator. Use Add administrator instead."
    );
  }

  return createAdmin_(name, email);
}


/************************************************************
 * SIDEBAR VIEWER MANAGEMENT
 ************************************************************/

function uiAddViewer(name, email) {
  ensureInstanceReady_();

  name = normalizedName_(name);
  email = normalizedEmail_(email);

  if (!name) throw new Error("Enter the viewer's name.");
  if (!validEmail_(email)) throw new Error("Enter a valid viewer email address.");

  var code = randomCode(3, 4);
  var sh = SpreadsheetApp.getActive().getSheetByName("Viewers");

  sh.appendRow([name, email, code, true]);

  var mail = sendAccessEmail_(email, name, code, "viewer");
  return credentialResult_(code, email, mail);
}


function uiSetViewerActive(idOrCode, active) {
  ensureInstanceReady_();

  var rows = readAccessRows_("Viewers", "code");
  var needle = String(idOrCode || "").trim().toLowerCase();
  var sh = SpreadsheetApp.getActive().getSheetByName("Viewers");

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].credential || "").trim().toLowerCase() !== needle) continue;

    sh.getRange(rows[i].row, rows[i].activeColumn).setValue(!!active);
    return uiStatus();
  }

  throw new Error("Viewer not found.");
}


function uiSetViewerEmail(idOrCode, email) {
  ensureInstanceReady_();

  email = normalizedEmail_(email);
  if (!validEmail_(email)) throw new Error("Enter a valid email address.");

  var rows = readAccessRows_("Viewers", "code");
  var needle = String(idOrCode || "").trim().toLowerCase();
  var sh = SpreadsheetApp.getActive().getSheetByName("Viewers");

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].credential || "").trim().toLowerCase() !== needle) continue;

    // By this point ensureInstanceReady_ has migrated legacy sheets.
    var cols = accessColumns_(sh, "code");
    sh.getRange(rows[i].row, cols.email + 1).setValue(email);
    return uiStatus();
  }

  throw new Error("Viewer not found.");
}


function uiEmailViewerCode(idOrCode) {
  ensureInstanceReady_();

  var rows = readAccessRows_("Viewers", "code");
  var needle = String(idOrCode || "").trim().toLowerCase();

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].credential || "").trim().toLowerCase() !== needle) continue;

    if (!validEmail_(rows[i].email)) {
      throw new Error("Set a valid email address for this viewer first.");
    }

    var mail = sendAccessEmail_(
      rows[i].email,
      rows[i].name || "Viewer",
      rows[i].credential,
      "viewer"
    );

    if (!mail.emailSent) {
      throw new Error("The email could not be sent: " + mail.emailError);
    }

    return {
      status: "success",
      email: rows[i].email
    };
  }

  throw new Error("Viewer not found.");
}


/************************************************************
 * SIDEBAR ADMIN MANAGEMENT
 ************************************************************/

function createAdmin_(name, email) {
  var sh = SpreadsheetApp.getActive().getSheetByName("Admins");
  var code = randomCode(3, 4);
  var hash = hashAdminCode_(code);

  sh.appendRow([
    name,
    email,
    hash,
    true
  ]);

  // A personal administrator is now the authority. The old shared
  // password model is permanently retired for this instance.
  retireLegacyAdminCredentials_();

  var mail = sendAccessEmail_(email, name, code, "admin");
  return credentialResult_(code, email, mail);
}


function uiAddAdmin(name, email) {
  ensureInstanceReady_();

  name = normalizedName_(name);
  email = normalizedEmail_(email);

  if (!name) throw new Error("Enter the administrator's name.");
  if (!validEmail_(email)) throw new Error("Enter a valid administrator email address.");

  return createAdmin_(name, email);
}


/**
 * Regenerates ONE administrator's personal code.
 * Everyone else's code keeps working.
 *
 * If an email address is saved, the replacement code is emailed
 * automatically. The plaintext code is still returned once to the
 * sidebar in case delivery fails.
 */
function uiRegenerateAdmin(id) {
  ensureInstanceReady_();

  var rows = readAccessRows_("Admins", "code_hash");
  var needle = String(id || "").trim().toLowerCase();
  var sh = SpreadsheetApp.getActive().getSheetByName("Admins");

  for (var i = 0; i < rows.length; i++) {
    var storedHash = String(rows[i].credential || "").trim().toLowerCase();
    if (storedHash !== needle) continue;

    var code = randomCode(3, 4);
    var newHash = hashAdminCode_(code);

    sh.getRange(rows[i].row, rows[i].credentialColumn).setValue(newHash);
    sh.getRange(rows[i].row, rows[i].activeColumn).setValue(true);

    var mail = sendAccessEmail_(
      rows[i].email,
      rows[i].name || "Administrator",
      code,
      "admin"
    );

    return credentialResult_(code, rows[i].email, mail);
  }

  throw new Error("Administrator not found.");
}


// Alias in case Sidebar.html used this wording.
function uiResetAdminCode(id) {
  return uiRegenerateAdmin(id);
}


function uiSetAdminEmail(id, email) {
  ensureInstanceReady_();

  email = normalizedEmail_(email);
  if (!validEmail_(email)) throw new Error("Enter a valid email address.");

  var rows = readAccessRows_("Admins", "code_hash");
  var needle = String(id || "").trim().toLowerCase();
  var sh = SpreadsheetApp.getActive().getSheetByName("Admins");

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].credential || "").trim().toLowerCase() !== needle) continue;

    var cols = accessColumns_(sh, "code_hash");
    sh.getRange(rows[i].row, cols.email + 1).setValue(email);
    return uiStatus();
  }

  throw new Error("Administrator not found.");
}


function uiSetAdminActive(id, active) {
  ensureInstanceReady_();

  var rows = readAccessRows_("Admins", "code_hash");
  var needle = String(id || "").trim().toLowerCase();
  var sh = SpreadsheetApp.getActive().getSheetByName("Admins");

  for (var i = 0; i < rows.length; i++) {
    var storedHash = String(rows[i].credential || "").trim().toLowerCase();

    if (storedHash !== needle) continue;

    if (!active && rows[i].active && countActiveAdmins_() <= 1 &&
        !getSetting("recovery_hash")) {
      throw new Error(
        "You cannot disable the last active administrator. Add another administrator first."
      );
    }

    sh.getRange(rows[i].row, rows[i].activeColumn).setValue(!!active);
    return uiStatus();
  }

  throw new Error("Administrator not found.");
}


/************************************************************
 * SIDEBAR ENTRY TOKEN MANAGEMENT
 ************************************************************/

function uiRotateEntryToken() {
  ensureInstanceReady_();

  var token = Utilities.getUuid();
  setSetting("entry_token", token);

  return token;
}


function uiSavePublicSiteSettings(baseUrl, supportEmail) {
  ensureInstanceReady_();
  savePublicSiteSettings_(baseUrl, supportEmail);
  return uiStatus();
}


/************************************************************
 * BREAK-GLASS ADMIN RECOVERY
 *
 * V3 recovery uses its own recovery_hash setting. It is separate
 * from all legacy shared-password settings.
 ************************************************************/

function createRecoveryCode_() {
  ensureInstanceReady_();

  var recovery = randomCode(3, 4);
  setSetting("recovery_hash", hashText_(recovery));

  Logger.log("NEW BREAK-GLASS RECOVERY CODE: " + recovery);
  Logger.log("Save it now. Only its hash is stored.");

  return recovery;
}


function uiCreateRecoveryCode() {
  return createRecoveryCode_();
}


// Compatibility aliases for an older sidebar file. These now create
// a v3 recovery code, not a shared administrator password.
function resetAdminPassword() {
  return createRecoveryCode_();
}


function uiResetAdminPassword() {
  return createRecoveryCode_();
}


function reissueSetupClaim() {
  return createRecoveryCode_();
}


function uiReissueSetupClaim() {
  return createRecoveryCode_();
}


/************************************************************
 * EDITOR-ONLY DIAGNOSTICS
 *
 * These are intentionally NOT included in doPost().
 ************************************************************/

function showCredentials() {
  ensureInstanceReady_();

  Logger.log(
    "Admin access: " +
    (adminCredentialExists_()
      ? "set (personal admin codes and/or recovery hash)"
      : "NOT SET")
  );

  Logger.log(
    "Active personal admins: " + countActiveAdmins_()
  );

  Logger.log(
    "Entry token: " + (getSetting("entry_token") || "(not set)")
  );

  var viewers = readViewerStatus_();
  Logger.log("Report-only viewers:");

  if (!viewers.length) {
    Logger.log("  (none)");
  } else {
    viewers.forEach(function (v) {
      Logger.log(
        "  " + v.name +
        " -> " + v.code +
        (v.active ? "" : " [DISABLED]")
      );
    });
  }

  Logger.log(
    "Admins automatically inherit report access. Their plaintext codes cannot be displayed."
  );
  Logger.log("API version: " + VT_API_VERSION);
  Logger.log("Schema version: " + getSchemaVersion_());
  Logger.log("Release: " + VT_RELEASE);
  Logger.log("Legacy admin credential present: " + (hasLegacyAdminCredential_() ? "YES" : "NO"));
  Logger.log("Recovery credential set: " + (getSetting("recovery_hash") ? "YES" : "NO"));
}


function debugSheet() {
  Logger.log(SpreadsheetApp.getActiveSpreadsheet().getUrl());
}


function debugSettingsValues() {
  var sh = SpreadsheetApp.getActive().getSheetByName("Settings");

  if (!sh) {
    Logger.log("Settings sheet not found.");
    return;
  }

  Logger.log(
    JSON.stringify(sh.getDataRange().getValues(), null, 2)
  );
}

/************************************************************
 * SHARED REPORT LAYOUTS (added in 3.1.0)
 *
 * Saved Reports-page layouts, shared by everyone at this school.
 *   - Anyone with Reports access (viewer or admin) can LIST them.
 *   - Only administrators can SAVE, DELETE, or SET THE DEFAULT.
 *
 * A layout only describes which report blocks to show and how. It
 * never contains student data. The Reports page validates every
 * layout before using it, so a damaged row cannot break the page.
 *
 * The "Report Layouts" tab is created the first time it is used.
 * VT_SCHEMA_VERSION is deliberately NOT bumped for this feature:
 * a schema bump would rotate the entry token and break every QR code.
 ************************************************************/

var LAYOUT_SHEET = "Report Layouts";
var LAYOUT_HEADERS = ["layout_id", "name", "layout_json", "updated_by", "updated_at", "is_default"];
var LAYOUT_MAX_JSON = 45000;   // under Google Sheets' 50,000-character cell limit
var LAYOUT_MAX_COUNT = 50;
var LAYOUT_MAX_NAME = 60;

function layoutSheet_() {
  return ensureSheet_(SpreadsheetApp.getActive(), LAYOUT_SHEET, LAYOUT_HEADERS).sheet;
}

function cellIsTrue_(value) {
  return value === true || String(value || "").trim().toLowerCase() === "true";
}

/**
 * Plain text for a sheet cell. Strips control characters and stops a
 * name such as "=IMPORTXML(...)" from becoming a live formula.
 */
function safeCellText_(value, maxLen) {
  var s = String(value == null ? "" : value).replace(/[\u0000-\u001f]/g, " ").trim();
  if (maxLen) s = s.slice(0, maxLen);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function readLayouts_() {
  var sh = layoutSheet_();
  if (sh.getLastRow() < 2) return [];

  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, LAYOUT_HEADERS.length).getValues();
  var out = [];

  rows.forEach(function (r, i) {
    var id = String(r[0] || "").trim();
    if (!id) return;

    var layout = null;
    try { layout = JSON.parse(String(r[2] || "")); } catch (err) { layout = null; }
    if (!layout || typeof layout !== "object") return;

    out.push({
      id: id,
      name: String(r[1] || "").replace(/^'/, "") || "Untitled layout",
      layout: layout,
      updatedBy: String(r[3] || ""),
      updatedAt: r[4] instanceof Date ? r[4].toISOString() : String(r[4] || ""),
      isDefault: cellIsTrue_(r[5]),
      row: i + 2
    });
  });

  return out;
}

function publicLayout_(l) {
  return {
    id: l.id,
    name: l.name,
    layout: l.layout,
    updatedBy: l.updatedBy,
    updatedAt: l.updatedAt,
    isDefault: l.isDefault
  };
}

function writeLayoutRow_(sh, row, values) {
  var range = sh.getRange(row, 1, 1, LAYOUT_HEADERS.length);
  range.setNumberFormat("@");   // keep every cell as plain text
  range.setValues([values]);
}

function withLayoutLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}


/************************************************************
 * LAYOUT ROUTES
 ************************************************************/

function listLayouts(d) {
  var user = lookupReportUser_(d.code);
  if (!user) return denied("Your access code is not valid or has been turned off.");

  return okReply({
    layouts: readLayouts_().map(publicLayout_),
    canEdit: user.role === "admin"
  });
}


function saveLayout(d) {
  var admin = requireAdmin_(d);
  if (!admin) return denied("Only administrators can save shared report layouts.");

  var name = safeCellText_(d.name, LAYOUT_MAX_NAME);
  if (!name) {
    return jsonReply({ status: "error", apiVersion: VT_API_VERSION, message: "Give the layout a name." });
  }

  if (!d.layout || typeof d.layout !== "object" || !Array.isArray(d.layout.blocks)) {
    return jsonReply({ status: "error", apiVersion: VT_API_VERSION, message: "That layout is not valid." });
  }

  var json = JSON.stringify(d.layout);
  if (json.length > LAYOUT_MAX_JSON) {
    return jsonReply({ status: "error", apiVersion: VT_API_VERSION, message: "That layout is too large to save. Remove some blocks or shorten text blocks." });
  }

  return withLayoutLock_(function () {
    var sh = layoutSheet_();
    var layouts = readLayouts_();
    var now = new Date().toISOString();
    var by = safeCellText_(admin.name || "Administrator", 80);

    if (d.id) {
      var existing = layouts.filter(function (l) { return l.id === String(d.id); })[0];
      if (!existing) {
        return jsonReply({ status: "error", apiVersion: VT_API_VERSION, message: "That layout no longer exists. Save it as a new layout." });
      }

      // Someone else saved it since this person opened it.
      if (d.expectUpdatedAt && String(d.expectUpdatedAt) !== existing.updatedAt) {
        return jsonReply({
          status: "error",
          code: "conflict",
          apiVersion: VT_API_VERSION,
          message: existing.updatedBy + " changed this layout after you opened it. Save yours as a new layout, or reload to see their version."
        });
      }

      writeLayoutRow_(sh, existing.row, [existing.id, name, json, by, now, existing.isDefault ? "TRUE" : "FALSE"]);
      return okReply({ layout: { id: existing.id, name: name.replace(/^'/, ""), layout: d.layout, updatedBy: by, updatedAt: now, isDefault: existing.isDefault } });
    }

    if (layouts.length >= LAYOUT_MAX_COUNT) {
      return jsonReply({ status: "error", apiVersion: VT_API_VERSION, message: "This school has reached " + LAYOUT_MAX_COUNT + " saved layouts. Delete one first." });
    }

    var id = "LAY-" + Utilities.getUuid();
    writeLayoutRow_(sh, sh.getLastRow() + 1, [id, name, json, by, now, "FALSE"]);
    return okReply({ layout: { id: id, name: name.replace(/^'/, ""), layout: d.layout, updatedBy: by, updatedAt: now, isDefault: false } });
  });
}


function deleteLayout(d) {
  var admin = requireAdmin_(d);
  if (!admin) return denied("Only administrators can delete shared report layouts.");

  return withLayoutLock_(function () {
    var sh = layoutSheet_();
    var match = readLayouts_().filter(function (l) { return l.id === String(d.id || ""); })[0];
    if (!match) {
      return jsonReply({ status: "error", apiVersion: VT_API_VERSION, message: "That layout was already deleted." });
    }
    sh.deleteRow(match.row);
    return okReply({});
  });
}


/** d.id = the layout to make the default, or "" for the built-in Standard report. */
function setDefaultLayout(d) {
  var admin = requireAdmin_(d);
  if (!admin) return denied("Only administrators can change the default report layout.");

  return withLayoutLock_(function () {
    var sh = layoutSheet_();
    var target = String(d.id || "");
    var layouts = readLayouts_();

    if (target && !layouts.some(function (l) { return l.id === target; })) {
      return jsonReply({ status: "error", apiVersion: VT_API_VERSION, message: "That layout no longer exists." });
    }

    layouts.forEach(function (l) {
      var cell = sh.getRange(l.row, 6);
      cell.setNumberFormat("@");
      cell.setValue(l.id === target ? "TRUE" : "FALSE");
    });

    return okReply({ defaultId: target });
  });
}
