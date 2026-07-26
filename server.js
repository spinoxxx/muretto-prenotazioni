import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import tls from "node:tls";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
const employeesFile = path.join(dataDir, "employees.json");
const bookingsFile = path.join(dataDir, "bookings.json");
const deletedBookingsFile = path.join(dataDir, "deleted-bookings.json");
const zoneSettingsFile = path.join(dataDir, "zone-settings.json");
const voiceCallbacksFile = path.join(dataDir, "voice-callbacks.json");
const backupsDir = path.join(dataDir, "backups");
const sessions = new Map();
const publicBookingAttempts = new Map();

const PORT = Number(process.env.PORT || 4220);
const HOST = process.env.HOST || "127.0.0.1";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const MAX_BODY_BYTES = 32 * 1024;
const BACKUP_INTERVAL_MS = Number(process.env.MURETTO_BACKUP_INTERVAL_MS || 1000 * 60 * 60 * 24);
const BACKUP_RETENTION = Number(process.env.MURETTO_BACKUP_RETENTION || 30);
const PUBLIC_BOOKING_WINDOW_MS = 1000 * 60 * 10;
const PUBLIC_BOOKING_MAX_ATTEMPTS = 8;
const RESTAURANT_ROOM = "Ristorante Esterno";
const LEGACY_RESTAURANT_ROOM = "Ristorante";
const ZONE_ROOMS = [RESTAURANT_ROOM, "Bar", "Giardino"];
const ZONE_PERIODS = ["day", "evening"];
const DEFAULT_ZONE_LIMITS = {
  [RESTAURANT_ROOM]: 40,
  Bar: 40,
  Giardino: 18
};
const PRIVACY_VERSION = "2026-06-26";
const PRIVACY_CONTROLLER = "Bar Flora srl, Piazza Vecchia 13, 24129 Bergamo";
const VENUE_ADDRESS = "Viale delle Mura 1, 24129 Bergamo";
const VENUE_MAP_URL = "https://www.google.com/maps/search/?api=1&query=Viale%20delle%20Mura%201%2C%2024129%20Bergamo";
const SPECIAL_EVENT_DATE = "2026-07-22";
const SPECIAL_EVENT_NAME = "Notte al Muretto";
const SPECIAL_EVENT_TIME = "20:00";
const SPECIAL_EVENT_PRICE = "45€ a persona, bevande escluse";
const SPECIAL_EVENT_MENU = "Antipasto: scampo flambato al Grand Marnier con purè di patate e olio all'erba cipollina. Primo: linguine alle vongole e bottarga. Dolce: cheese cake.";
const PUBLIC_AUTO_CONFIRM_LIMIT_RATIO = 0.85;
const PUBLIC_SLOT_INTERVAL_MINUTES = 15;
const PUBLIC_SLOT_MAX_BOOKINGS = 3;
const PUBLIC_SLOT_WINDOWS = {
  lunch: { start: "12:00", end: "14:30" },
  aperitivo: { start: "18:00", end: "20:30" },
  dinner: { start: "19:00", end: "22:00" }
};
const PUBLIC_BASE_URL = sanitizePublicText(process.env.MURETTO_PUBLIC_URL, "https://muretto-prenotazioni.onrender.com", 220).replace(/\/+$/, "");
const PUBLIC_BOOKING_URL = `${PUBLIC_BASE_URL}/prenota.html`;

const DEFAULT_EMPLOYEE_NAME = process.env.MURETTO_ADMIN_NAME || "Admin";
const DEFAULT_EMPLOYEE_PIN = process.env.MURETTO_ADMIN_PIN || "123456";
const SYNC_ADMIN_PIN = process.env.MURETTO_SYNC_ADMIN_PIN === "true";
const privacyControllerEnv = process.env.MURETTO_PRIVACY_CONTROLLER;
const EMAIL_FROM = sanitizePublicText(process.env.MURETTO_EMAIL_FROM, "", 160);
const NOTIFICATION_EMAIL = sanitizePublicText(process.env.MURETTO_NOTIFICATION_EMAIL || extractEmailAddress(EMAIL_FROM), "", 160);
const RESEND_API_KEY = process.env.MURETTO_RESEND_API_KEY || "";
const VOICE_API_TOKEN = String(process.env.MURETTO_VOICE_API_TOKEN || "").trim();
const DEFAULT_TELNYX_RELAY_URL = `${PUBLIC_BASE_URL.replace(/^http/, "ws")}/telnyx/conversation${VOICE_API_TOKEN ? `?token=${encodeURIComponent(VOICE_API_TOKEN)}` : ""}`;
const TELNYX_RELAY_URL = sanitizePublicText(process.env.MURETTO_TELNYX_RELAY_URL, DEFAULT_TELNYX_RELAY_URL, 320);
const TELNYX_RELAY_VOICE = sanitizePublicText(process.env.MURETTO_TELNYX_RELAY_VOICE, "Telnyx.Natural.abbie", 80);
const TELNYX_RELAY_LANGUAGE = sanitizePublicText(process.env.MURETTO_TELNYX_RELAY_LANGUAGE, "it-IT", 20);
const SMTP_HOST = sanitizePublicText(process.env.MURETTO_SMTP_HOST, "", 120);
const SMTP_PORT = Number(process.env.MURETTO_SMTP_PORT || 465);
const SMTP_USER = sanitizePublicText(process.env.MURETTO_SMTP_USER, "", 160);
const SMTP_PASS = String(process.env.MURETTO_SMTP_PASS || "").replace(/\s+/g, "");
const BRAND_CONFIG = {
  name: sanitizePublicText(process.env.MURETTO_BRAND_NAME === "Il Muretto" ? "Muretto" : process.env.MURETTO_BRAND_NAME, "Muretto", 80),
  category: sanitizePublicText(process.env.MURETTO_BRAND_CATEGORY, "Bistrot", 40),
  monogram: sanitizePublicText(process.env.MURETTO_BRAND_MONOGRAM, "M", 4).toUpperCase(),
  appTitle: sanitizePublicText(process.env.MURETTO_APP_TITLE, "Muretto Prenotazioni", 80),
  loginDescription: sanitizePublicText(process.env.MURETTO_LOGIN_DESCRIPTION, "Registro prenotazioni riservato allo staff.", 140),
  agendaDescription: sanitizePublicText(process.env.MURETTO_AGENDA_DESCRIPTION, "Consultazione prenotazioni riservata allo staff autorizzato.", 160),
  privacy: {
    version: PRIVACY_VERSION,
    controller: sanitizePublicText(privacyControllerEnv && privacyControllerEnv !== "Il Muretto" ? privacyControllerEnv : PRIVACY_CONTROLLER, PRIVACY_CONTROLLER, 160),
    contact: sanitizePublicText(process.env.MURETTO_PRIVACY_CONTACT, "Contatta il locale per richieste privacy o cancellazione dati.", 180),
    retention: sanitizePublicText(process.env.MURETTO_PRIVACY_RETENTION, "I dati vengono conservati solo per gestire la prenotazione e le esigenze operative del locale.", 220)
  },
  colors: {
    accent: sanitizeHexColor(process.env.MURETTO_BRAND_PRIMARY, "#2f6f5e"),
    accentDark: sanitizeHexColor(process.env.MURETTO_BRAND_PRIMARY_DARK, "#1f4e42"),
    warm: sanitizeHexColor(process.env.MURETTO_BRAND_WARM, "#b25f3a")
  }
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
};

const securityHeaders = {
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "geolocation=(), microphone=(), camera=(), payment=()"
};

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function hashValue(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function normalizeLanguage(language) {
  return String(language || "").trim().toLowerCase() === "en" ? "en" : "it";
}

function sanitizeText(value, max = 180) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function sanitizePublicText(value, fallback, max = 120) {
  const text = String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
  return text || fallback;
}

function sanitizeMessageText(value, max = 2000) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, max);
}

function traceTimestamp(value = new Date()) {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}

function romeNowParts() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function appendBookingNote(booking, note) {
  const current = sanitizeMessageText(booking.notes, 1600);
  const line = `[${traceTimestamp()}] ${sanitizeMessageText(note, 360)}`;
  return [current, line].filter(Boolean).join("\n");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function sanitizeHexColor(value, fallback) {
  const text = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function normalizeDate(value) {
  const text = sanitizeText(value, 10);
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return text;
  const italianMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!italianMatch) return text;
  const [, day, month, year] = italianMatch;
  return `${year}-${month}-${day}`;
}

function normalizeClockTime(value) {
  const text = sanitizeText(value, 5);
  const match = text.match(/^(\d{2}):(\d{2})$/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "";
  return text;
}

function clockTimeToMinutes(value) {
  const time = normalizeClockTime(value);
  if (!time) return null;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function sanitizeProposedTimes(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(raw.map(normalizeClockTime).filter(Boolean))].slice(0, 16);
}

function sanitizeProposedTimesForBooking(value, booking) {
  const requested = clockTimeToMinutes(booking.time);
  if (requested === null) return [];
  return sanitizeProposedTimes(value).filter((time) => {
    const minutes = clockTimeToMinutes(time);
    return minutes !== null && Math.abs(minutes - requested) <= 90 && minutes !== requested;
  });
}

function pinIsValid(pin) {
  return /^\d{4,12}$/.test(String(pin || ""));
}

async function hashPin(pin, salt = randomToken(16)) {
  const key = await new Promise((resolve, reject) => {
    crypto.scrypt(String(pin), salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
  return { salt, hash: key.toString("hex") };
}

async function verifyPin(pin, employee) {
  const candidate = await hashPin(pin, employee.pinSalt);
  const expected = Buffer.from(employee.pinHash, "hex");
  const actual = Buffer.from(candidate.hash, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function ensureDataFiles() {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(backupsDir, { recursive: true, mode: 0o700 });
  try {
    await fs.access(employeesFile);
  } catch {
    const { salt, hash } = await hashPin(DEFAULT_EMPLOYEE_PIN);
    await writeJson(employeesFile, [
      {
        id: crypto.randomUUID(),
        name: DEFAULT_EMPLOYEE_NAME,
        role: "admin",
        pinSalt: salt,
        pinHash: hash,
        active: true,
        createdAt: new Date().toISOString()
      }
    ]);
    console.log(`Primo accesso: dipendente "${DEFAULT_EMPLOYEE_NAME}" creato. Cambia il PIN in produzione tramite variabile MURETTO_ADMIN_PIN.`);
  }

  if (SYNC_ADMIN_PIN && pinIsValid(DEFAULT_EMPLOYEE_PIN)) {
    const employees = await readJson(employeesFile, []);
    const adminIndex = employees.findIndex((employee) => employee.name.toLowerCase() === DEFAULT_EMPLOYEE_NAME.toLowerCase());
    const { salt, hash } = await hashPin(DEFAULT_EMPLOYEE_PIN);
    const syncedAdmin = {
      ...(adminIndex >= 0 ? employees[adminIndex] : {}),
      id: adminIndex >= 0 ? employees[adminIndex].id : crypto.randomUUID(),
      name: DEFAULT_EMPLOYEE_NAME,
      role: "admin",
      pinSalt: salt,
      pinHash: hash,
      active: true,
      createdAt: adminIndex >= 0 ? employees[adminIndex].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: "system"
    };
    if (adminIndex >= 0) employees[adminIndex] = syncedAdmin;
    else employees.push(syncedAdmin);
    await writeJson(employeesFile, employees);
    console.log(`Admin "${DEFAULT_EMPLOYEE_NAME}" sincronizzato dalle variabili ambiente.`);
  }

  try {
    await fs.access(bookingsFile);
  } catch {
    await writeJson(bookingsFile, []);
  }

  try {
    await fs.access(deletedBookingsFile);
  } catch {
    await writeJson(deletedBookingsFile, []);
  }

  try {
    await fs.access(zoneSettingsFile);
  } catch {
    await writeJson(zoneSettingsFile, {});
  }

  try {
    await fs.access(voiceCallbacksFile);
  } catch {
    await writeJson(voiceCallbacksFile, []);
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}

function backupFileName(date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `muretto-backup-${stamp}.json`;
}

function isBackupFileName(name) {
  return /^muretto-backup-\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/.test(String(name || ""));
}

async function listBackupFiles() {
  const entries = await fs.readdir(backupsDir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isBackupFileName(entry.name)) continue;
    const filePath = path.join(backupsDir, entry.name);
    const stat = await fs.stat(filePath);
    files.push({ name: entry.name, createdAt: stat.mtime.toISOString(), size: stat.size });
  }
  return files.sort((a, b) => b.name.localeCompare(a.name));
}

async function pruneBackups() {
  const files = await listBackupFiles();
  const oldFiles = files.slice(Math.max(0, BACKUP_RETENTION));
  await Promise.all(oldFiles.map((file) => fs.unlink(path.join(backupsDir, file.name)).catch(() => {})));
}

async function createBackup(reason = "manuale", actor = "system") {
  await fs.mkdir(backupsDir, { recursive: true, mode: 0o700 });
  const createdAt = new Date().toISOString();
  const backup = {
    version: 1,
    createdAt,
    reason,
    actor,
    data: {
      bookings: await readJson(bookingsFile, []),
      employees: await readJson(employeesFile, []),
      deletedBookings: await readJson(deletedBookingsFile, []),
      zoneSettings: await readJson(zoneSettingsFile, {}),
      voiceCallbacks: await readJson(voiceCallbacksFile, [])
    }
  };
  const name = backupFileName(new Date(createdAt));
  await writeJson(path.join(backupsDir, name), backup);
  await pruneBackups();
  const stat = await fs.stat(path.join(backupsDir, name));
  return { name, createdAt, size: stat.size };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { ...jsonHeaders, ...securityHeaders });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, status, title, message) {
  res.writeHead(status, {
    ...securityHeaders,
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(`<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
      body{margin:0;background:#f7f4ed;color:#1f2320;font-family:Arial,sans-serif;display:grid;min-height:100vh;place-items:center;padding:20px}
      main{max-width:560px;border:1px solid #ded8ce;border-radius:8px;background:#fff;padding:28px;box-shadow:0 18px 40px rgb(31 35 32 / 12%)}
      h1{margin:0 0 10px;font-size:1.7rem}p{margin:0 0 18px;line-height:1.5}a{color:#1f4e42;font-weight:700}
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <a href="${PUBLIC_BOOKING_URL}">Vai al modulo prenotazioni</a>
    </main>
  </body>
</html>`);
}

function sendXml(res, status, xml) {
  res.writeHead(status, {
    ...securityHeaders,
    "content-type": "application/xml; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(xml);
}

function sendDownload(res, fileName, content) {
  res.writeHead(200, {
    ...securityHeaders,
    "content-type": "application/json; charset=utf-8",
    "content-disposition": `attachment; filename="${fileName}"`,
    "cache-control": "no-store"
  });
  res.end(content);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header.split(";").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, decodeURIComponent(rest.join("=") || "")];
    }).filter(([key]) => key)
  );
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Payload troppo grande");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function getSession(req) {
  const token = parseCookies(req).muretto_session;
  if (!token) return null;
  const session = sessions.get(hashValue(token));
  if (!session || session.expiresAt < Date.now()) {
    if (session) sessions.delete(hashValue(token));
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function requireSession(req, res) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { error: "Accesso richiesto" });
    return null;
  }
  if (req.method !== "GET" && req.headers["x-csrf-token"] !== session.csrfToken) {
    sendJson(res, 403, { error: "Richiesta non valida" });
    return null;
  }
  return session;
}

function sessionCookie(token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `muretto_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}

function clearSessionCookie() {
  return "muretto_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
}

async function serveStatic(req, res) {
  const requested = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const safePath = requested === "/" ? "/index.html" : requested;
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, securityHeaders);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".svg": "image/svg+xml"
    };
    res.writeHead(200, {
      ...securityHeaders,
      "content-type": types[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(content);
  } catch {
    res.writeHead(404, securityHeaders);
    res.end("Not found");
  }
}

function validateBooking(input) {
  const booking = {
    guestName: sanitizeText(input.guestName, 80),
    phone: sanitizeText(input.phone, 40),
    email: sanitizeText(input.email, 120),
    date: normalizeDate(input.date),
    time: sanitizeText(input.time, 5),
    people: Number(input.people),
    room: sanitizeText(input.room, 60),
    tableNumber: sanitizeText(input.tableNumber, 30),
    status: sanitizeText(input.status || "confermata", 20),
    language: normalizeLanguage(input.language),
    notes: sanitizeText(input.notes, 300),
    customerNotes: sanitizeText(input.customerNotes, 220)
  };

  const statuses = new Set(["confermata", "in attesa", "da verificare", "arrivati", "annullata", "completata"]);
  const rooms = new Set([RESTAURANT_ROOM, LEGACY_RESTAURANT_ROOM, "Bar", "Giardino", "Interno"]);
  if (booking.room === LEGACY_RESTAURANT_ROOM) booking.room = RESTAURANT_ROOM;
  if (!booking.guestName) return "Inserisci il nome del cliente.";
  if (!booking.phone && !booking.email) return "Serve almeno un recapito.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booking.date)) return "Data non valida.";
  if (!/^\d{2}:\d{2}$/.test(booking.time)) return "Orario non valido.";
  if (!Number.isInteger(booking.people) || booking.people < 1 || booking.people > 40) return "Numero di persone non valido.";
  if (!booking.room) return "Seleziona la sala.";
  if (!rooms.has(booking.room)) return "Sala non valida.";
  if (!statuses.has(booking.status)) return "Stato non valido.";
  return booking;
}

function validatePhoneBooking(input) {
  if (input.phonePrivacyAccepted !== true && input.phonePrivacyAccepted !== "true" && input.phonePrivacyAccepted !== "on") {
    return "Conferma di aver comunicato l'informativa privacy al telefono.";
  }
  const booking = validateBooking(input);
  if (typeof booking === "string") return booking;
  return {
    ...booking,
    notes: appendBookingNote(booking, "Prenotazione ricevuta telefonicamente. Informativa privacy comunicata e accettata al telefono.")
  };
}

function voiceAuthToken(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function tokenMatches(actual, expected) {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function requireVoiceApi(req, res) {
  if (!VOICE_API_TOKEN) {
    sendJson(res, 503, { error: "Segreteria telefonica non configurata" });
    return false;
  }
  if (!tokenMatches(voiceAuthToken(req), VOICE_API_TOKEN)) {
    sendJson(res, 401, { error: "Token segreteria non valido" });
    return false;
  }
  return true;
}

function voiceBookingDraft(input, status = "confermata") {
  const consumption = sanitizeText(input.consumption, 20).toLowerCase();
  const gardenRequested = input.gardenRequested === true || input.gardenRequested === "on" || input.gardenRequested === "true";
  const privacyAccepted = input.privacyAccepted === true || input.privacyAccepted === "on" || input.privacyAccepted === "true";
  const allowedConsumptions = new Set(["cena", "aperitivo"]);
  if (!privacyAccepted) return "Serve il consenso privacy comunicato al telefono.";
  if (!allowedConsumptions.has(consumption)) return "La segreteria deve indicare cena o aperitivo.";
  if (gardenRequested && consumption !== "cena") return "Il giardino si puo richiedere solo per pranzo/cena.";

  const room = consumption === "aperitivo" ? "Bar" : gardenRequested ? "Giardino" : RESTAURANT_ROOM;
  const notes = [
    "Prenotazione raccolta da segreteria telefonica automatica.",
    `Consumazione prevista: ${consumption}.`,
    gardenRequested ? "Richiesta giardino: accettata solo se confermata dal backend." : "",
    sanitizeText(input.notes, 260)
  ].filter(Boolean).join(" ");

  const booking = validateBooking({
    guestName: input.guestName,
    phone: input.phone,
    email: input.email,
    date: input.date,
    time: input.time,
    people: input.people,
    room,
    tableNumber: "",
    status,
    language: normalizeLanguage(input.language),
    notes
  });
  return typeof booking === "string" ? booking : booking;
}

async function voiceAvailability(input, bookings = null) {
  const draft = voiceBookingDraft({ ...input, guestName: input.guestName || "Cliente telefono", phone: input.phone || "telefono" }, "da verificare");
  if (typeof draft === "string") return { ok: false, reason: draft };
  const allBookings = bookings || await readJson(bookingsFile, []);
  const zoneError = await publicZoneError(draft, allBookings);
  const settings = await getZoneSettings(draft.date);
  const period = mealPeriod(draft.time);
  const rule = settings.zones?.[draft.room]?.[period] || { limit: 0, blocked: false };
  const occupied = ZONE_ROOMS.includes(draft.room) ? zoneOccupancy(allBookings, draft) : 0;
  return {
    ok: !zoneError,
    reason: zoneError,
    date: draft.date,
    time: draft.time,
    people: draft.people,
    room: draft.room,
    period,
    occupied,
    limit: Number(rule.limit || 0),
    blocked: Boolean(rule.blocked)
  };
}

async function createVoiceBooking(input) {
  const draft = voiceBookingDraft(input, "confermata");
  if (typeof draft === "string") return { ok: false, status: 400, error: draft };
  const bookings = await readJson(bookingsFile, []);
  const availability = await voiceAvailability(input, bookings);
  if (!availability.ok) return { ok: false, status: 409, error: availability.reason, availability };
  const now = new Date().toISOString();
  let booking = {
    id: crypto.randomUUID(),
    ...draft,
    bookingChannel: "segreteria telefonica",
    voiceRequestId: sanitizeText(input.requestId, 80),
    phonePrivacyAcceptedAt: now,
    phonePrivacyAcceptedBy: "segreteria telefonica",
    privacyAcceptedAt: now,
    privacyVersion: PRIVACY_VERSION,
    createdBy: "segreteria telefonica",
    createdAt: now,
    updatedAt: now,
    updatedBy: "segreteria telefonica"
  };
  bookings.push(booking);
  await writeJson(bookingsFile, bookings);
  booking = await markConfirmationEmailIfNeeded(null, booking, "segreteria telefonica");
  booking = await markVoiceBookingNotification(booking);
  bookings[bookings.length - 1] = booking;
  await writeJson(bookingsFile, bookings);
  return {
    ok: true,
    status: 201,
    booking: {
      id: booking.id,
      date: booking.date,
      time: booking.time,
      people: booking.people,
      room: booking.room,
      status: booking.status,
      confirmationEmailSentAt: booking.confirmationEmailSentAt || ""
    }
  };
}

async function createVoiceCallback(input) {
  const callbacks = await readJson(voiceCallbacksFile, []);
  const now = new Date().toISOString();
  const callback = {
    id: crypto.randomUUID(),
    requestId: sanitizeText(input.requestId, 80),
    guestName: sanitizeText(input.guestName, 80),
    phone: sanitizeText(input.phone, 40),
    email: sanitizeText(input.email, 120),
    reason: sanitizeMessageText(input.reason || "Richiesta da richiamare dalla segreteria telefonica.", 500),
    preferredCallbackWindow: sanitizeText(input.preferredCallbackWindow, 80),
    notes: sanitizeMessageText(input.notes, 800),
    createdAt: now,
    createdBy: "segreteria telefonica"
  };
  callbacks.push(callback);
  await writeJson(voiceCallbacksFile, callbacks);
  await sendPlainEmail({
    to: NOTIFICATION_EMAIL,
    subject: `Richiesta richiamata segreteria - ${BRAND_CONFIG.name}`,
    text: [
      "La segreteria telefonica ha creato una richiesta di richiamata.",
      "",
      callback.guestName ? `Cliente: ${callback.guestName}` : "",
      callback.phone ? `Telefono: ${callback.phone}` : "",
      callback.email ? `Email: ${callback.email}` : "",
      `Motivo: ${callback.reason}`,
      callback.preferredCallbackWindow ? `Fascia richiamata: ${callback.preferredCallbackWindow}` : "",
      callback.notes ? `Note: ${callback.notes}` : "",
      "",
      `Ricevuta il: ${callback.createdAt}`
    ].filter(Boolean).join("\n")
  }).catch((error) => console.error(error));
  return { ok: true, callback: { id: callback.id, createdAt: callback.createdAt } };
}

function normalizeSpeech(value) {
  return String(value || "").trim().toLowerCase();
}

function parseItalianDate(text) {
  const value = normalizeSpeech(text);
  const iso = value.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const numeric = value.match(/\b(\d{1,2})[\/\-. ](\d{1,2})(?:[\/\-. ](20\d{2}))?\b/);
  if (numeric) {
    const year = numeric[3] || new Date().getFullYear();
    return `${year}-${String(numeric[2]).padStart(2, "0")}-${String(numeric[1]).padStart(2, "0")}`;
  }
  const weekdays = {
    oggi: 0,
    domani: 1
  };
  if (Object.prototype.hasOwnProperty.call(weekdays, value)) return addDaysIso(new Date(), weekdays[value]);
  return "";
}

function addDaysIso(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy.toISOString().slice(0, 10);
}

function parseItalianTime(text) {
  const value = normalizeSpeech(text).replace(/[,.]/g, ":");
  const match = value.match(/\b(\d{1,2})(?::|\s+e\s+|\s*)(\d{2})?\b/);
  if (!match) return "";
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes > 59) return "";
  if (hours < 12 && /\b(sera|cena|serale)\b/.test(value)) hours += 12;
  if (hours > 23) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parsePeople(text) {
  const value = normalizeSpeech(text);
  const words = {
    uno: 1,
    una: 1,
    due: 2,
    tre: 3,
    quattro: 4,
    cinque: 5,
    sei: 6,
    sette: 7,
    otto: 8,
    nove: 9,
    dieci: 10,
    undici: 11,
    dodici: 12
  };
  const numeric = value.match(/\b(\d{1,2})\b/);
  if (numeric) return Number(numeric[1]);
  for (const [word, number] of Object.entries(words)) {
    if (value.includes(word)) return number;
  }
  return 0;
}

function yesNo(text) {
  const value = normalizeSpeech(text);
  if (/\b(si|sì|confermo|esatto|va bene|ok)\b/.test(value)) return true;
  if (/\b(no|annulla|sbagliato|non va bene)\b/.test(value)) return false;
  return null;
}

function voiceSummary(data) {
  return `${data.guestName}, ${data.people} persone, ${data.date} alle ${data.time}, ${data.consumption === "aperitivo" ? "aperitivo in zona bar" : data.gardenRequested ? "cena con richiesta giardino" : "pranzo o cena in zona ristorante esterno"}.`;
}

function nextVoicePrompt(state) {
  const data = state.data;
  if (!data.guestName) return { field: "guestName", text: "Perfetto. Mi dici nome e cognome per la prenotazione?" };
  if (!data.phone) return { field: "phone", text: "Mi lasci un numero di telefono per ricontattarti se necessario?" };
  if (!data.date) return { field: "date", text: "Per quale giorno vuoi prenotare? Puoi dire ad esempio domani oppure 20 luglio." };
  if (!data.time) return { field: "time", text: "A che ora vuoi arrivare?" };
  if (!data.people) return { field: "people", text: "Per quante persone?" };
  if (!data.consumption) return { field: "consumption", text: "Si tratta di pranzo o cena, oppure aperitivo?" };
  if (data.consumption === "cena" && data.gardenRequested === null) return { field: "gardenRequested", text: "Vuoi richiedere il giardino, sapendo che va confermato in base alla disponibilità?" };
  return { field: "confirm", text: `Riepilogo: ${voiceSummary(data)} Confermi la prenotazione?` };
}

function applyVoiceAnswer(state, text) {
  const field = state.awaiting;
  const data = state.data;
  const raw = sanitizeMessageText(text, 500);
  if (!raw) return;
  if (field === "guestName") data.guestName = sanitizeText(raw.replace(/^mi chiamo\s+/i, ""), 80);
  else if (field === "phone") data.phone = sanitizeText(raw.replace(/\D+/g, ""), 40) || sanitizeText(raw, 40);
  else if (field === "date") data.date = parseItalianDate(raw);
  else if (field === "time") data.time = parseItalianTime(raw);
  else if (field === "people") data.people = parsePeople(raw);
  else if (field === "consumption") {
    const value = normalizeSpeech(raw);
    data.consumption = value.includes("aper") ? "aperitivo" : "cena";
  } else if (field === "gardenRequested") {
    data.gardenRequested = yesNo(raw) === true;
  } else if (field === "confirm") {
    state.confirmed = yesNo(raw);
  }
  if (field !== "confirm" && !state.notes.includes(raw)) state.notes.push(raw);
}

function websocketAcceptKey(key) {
  return crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

function websocketFrame(text) {
  const payload = Buffer.from(text);
  const header = payload.length < 126
    ? Buffer.from([0x81, payload.length])
    : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

function websocketCloseFrame() {
  return Buffer.from([0x88, 0x00]);
}

function parseWebsocketFrames(state, chunk) {
  state.buffer = Buffer.concat([state.buffer, chunk]);
  const messages = [];
  while (state.buffer.length >= 2) {
    const first = state.buffer[0];
    const second = state.buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) === 0x80;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (state.buffer.length < 4) break;
      length = state.buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (state.buffer.length < 10) break;
      length = Number(state.buffer.readBigUInt64BE(2));
      offset = 10;
    }
    const maskOffset = offset;
    if (masked) offset += 4;
    if (state.buffer.length < offset + length) break;
    const payload = Buffer.from(state.buffer.slice(offset, offset + length));
    if (masked) {
      const mask = state.buffer.slice(maskOffset, maskOffset + 4);
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    }
    state.buffer = state.buffer.slice(offset + length);
    if (opcode === 0x8) messages.push({ type: "close" });
    else if (opcode === 0x1) messages.push({ type: "text", text: payload.toString("utf8") });
  }
  return messages;
}

function telnyxSendText(socket, text) {
  socket.write(websocketFrame(JSON.stringify({ type: "text", token: text, last: true })));
}

function telnyxEnd(socket, reason = "done") {
  socket.write(websocketFrame(JSON.stringify({ type: "end", handoffData: JSON.stringify({ reason }) })));
}

async function handleTelnyxFrame(socket, state, frame) {
  if (frame.type === "setup") {
    state.sessionId = sanitizeText(frame.sessionId, 80);
    const prompt = nextVoicePrompt(state);
    state.awaiting = prompt.field;
    telnyxSendText(socket, prompt.text);
    return;
  }
  if (frame.type !== "prompt" || frame.last === false) return;
  applyVoiceAnswer(state, frame.voicePrompt || frame.transcript || frame.text || "");
  if (state.awaiting === "confirm" && state.confirmed === false) {
    await createVoiceCallback({
      requestId: state.sessionId,
      ...state.data,
      reason: "Cliente non ha confermato il riepilogo della segreteria telefonica.",
      notes: state.notes.join(" | ")
    });
    telnyxSendText(socket, "Va bene, non confermo la prenotazione. Lascerò una richiesta allo staff per richiamarti. A presto.");
    telnyxEnd(socket, "callback_requested");
    return;
  }
  if (state.awaiting === "confirm" && state.confirmed === true) {
    const result = await createVoiceBooking({
      requestId: state.sessionId,
      ...state.data,
      privacyAccepted: true,
      notes: state.notes.join(" | ")
    });
    if (result.ok) {
      telnyxSendText(socket, `Perfetto, la prenotazione è confermata per ${state.data.people} persone il ${state.data.date} alle ${state.data.time}. A presto.`);
      telnyxEnd(socket, "booking_confirmed");
    } else {
      await createVoiceCallback({
        requestId: state.sessionId,
        ...state.data,
        reason: result.error || "Prenotazione non confermabile dalla segreteria.",
        notes: state.notes.join(" | ")
      });
      telnyxSendText(socket, "Mi dispiace, non riesco a confermare automaticamente questa prenotazione. Ho lasciato una richiesta allo staff per richiamarti.");
      telnyxEnd(socket, "callback_requested");
    }
    return;
  }
  const prompt = nextVoicePrompt(state);
  state.awaiting = prompt.field;
  telnyxSendText(socket, prompt.text);
}

function handleTelnyxConversation(req, socket) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!tokenMatches(url.searchParams.get("token"), VOICE_API_TOKEN)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${websocketAcceptKey(key)}`,
    "\r\n"
  ].join("\r\n"));

  const state = {
    buffer: Buffer.alloc(0),
    sessionId: "",
    awaiting: "",
    confirmed: null,
    notes: [],
    data: {
      guestName: "",
      phone: "",
      email: "",
      date: "",
      time: "",
      people: 0,
      consumption: "",
      gardenRequested: null,
      privacyAccepted: true
    }
  };

  socket.on("data", (chunk) => {
    for (const message of parseWebsocketFrames(state, chunk)) {
      if (message.type === "close") {
        socket.write(websocketCloseFrame());
        socket.end();
        return;
      }
      try {
        const frame = JSON.parse(message.text);
        handleTelnyxFrame(socket, state, frame).catch((error) => {
          console.error(error);
          telnyxSendText(socket, "Si è verificato un problema. Chiederò allo staff di richiamarti.");
          telnyxEnd(socket, "error");
        });
      } catch (error) {
        console.error(error);
      }
    }
  });
}

function publicValidationError(error, language) {
  if (language !== "en") return error;
  const translations = new Map([
    ["Inserisci il nome del cliente.", "Enter the guest name."],
    ["Serve almeno un recapito.", "Enter at least one contact detail."],
    ["Data non valida.", "Invalid date."],
    ["Orario non valido.", "Invalid time."],
    ["Numero di persone non valido.", "Invalid number of guests."],
    ["Sala non valida.", "Invalid area."],
    ["Stato non valido.", "Invalid status."]
  ]);
  return translations.get(error) || "Something went wrong";
}

function validatePublicBooking(input) {
  const consumption = sanitizeText(input.consumption, 20).toLowerCase();
  const language = normalizeLanguage(input.language);
  const gardenRequested = input.gardenRequested === true || input.gardenRequested === "on" || input.gardenRequested === "true";
  const privacyAccepted = input.privacyAccepted === true || input.privacyAccepted === "on" || input.privacyAccepted === "true";
  const customerNotes = sanitizeText(input.notes, 220);
  const allowedConsumptions = new Set(["cena", "aperitivo"]);
  if (!privacyAccepted) return language === "en" ? "You must read and accept the privacy notice." : "Devi leggere e accettare l'informativa privacy.";
  if (!allowedConsumptions.has(consumption)) return language === "en" ? "Choose lunch/dinner or aperitif." : "Scegli pranzo/cena o aperitivo.";
  if (gardenRequested && consumption !== "cena") return language === "en" ? "The garden can only be requested for lunch/dinner." : "Il giardino si puo richiedere solo per pranzo/cena.";
  if (!sanitizeText(input.email, 120)) return language === "en" ? "Enter an email address to receive confirmation." : "Inserisci un indirizzo email per ricevere la conferma.";

  const room = consumption === "aperitivo" ? "Bar" : gardenRequested ? "Giardino" : RESTAURANT_ROOM;
  const notes = [
    "Richiesta dal modulo online.",
    `Consumazione prevista: ${consumption}.`,
    gardenRequested ? "Richiesta giardino: da confermare." : "",
    input.date === SPECIAL_EVENT_DATE ? `Data evento ${SPECIAL_EVENT_NAME}: Cena & Jazz ore ${SPECIAL_EVENT_TIME}, ${SPECIAL_EVENT_PRICE}.` : "",
    customerNotes
  ].filter(Boolean).join(" ");

  const booking = validateBooking({
    guestName: input.guestName,
    phone: input.phone,
    email: input.email,
    date: input.date,
    time: input.time,
    people: input.people,
    room,
    tableNumber: "",
    status: "da verificare",
    language,
    notes,
    customerNotes
  });
  return typeof booking === "string" ? publicValidationError(booking, language) : booking;
}

function mealPeriod(time) {
  const [hours] = String(time || "").split(":").map(Number);
  return Number.isFinite(hours) && hours >= 18 ? "evening" : "day";
}

function minutesToClockTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function publicSlotTimes(consumption) {
  const windows = sanitizeText(consumption, 20).toLowerCase() === "aperitivo"
    ? [PUBLIC_SLOT_WINDOWS.aperitivo]
    : [PUBLIC_SLOT_WINDOWS.lunch, PUBLIC_SLOT_WINDOWS.dinner];
  return windows.flatMap((window) => {
    const start = clockTimeToMinutes(window.start);
    const end = clockTimeToMinutes(window.end);
    const slots = [];
    for (let minutes = start; minutes <= end; minutes += PUBLIC_SLOT_INTERVAL_MINUTES) {
      slots.push(minutesToClockTime(minutes));
    }
    return slots;
  });
}

function emptyZonePeriod(room) {
  return { limit: DEFAULT_ZONE_LIMITS[room] || 0, blocked: false };
}

function defaultZoneSettings(date) {
  return {
    date,
    zones: Object.fromEntries(ZONE_ROOMS.map((room) => [
      room,
      Object.fromEntries(ZONE_PERIODS.map((period) => [period, emptyZonePeriod(room)]))
    ]))
  };
}

function normalizeLimit(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(999, Math.floor(number));
}

function normalizeZoneSettings(date, input = {}) {
  const settings = defaultZoneSettings(date);
  const zones = input.zones && typeof input.zones === "object" ? input.zones : input;
  for (const room of ZONE_ROOMS) {
    for (const period of ZONE_PERIODS) {
      const source = zones?.[room]?.[period] || (room === RESTAURANT_ROOM ? zones?.[LEGACY_RESTAURANT_ROOM]?.[period] : {}) || {};
      const hasLimit = Object.prototype.hasOwnProperty.call(source, "limit");
      settings.zones[room][period] = {
        limit: hasLimit ? normalizeLimit(source.limit) : settings.zones[room][period].limit,
        blocked: source.blocked === true || source.blocked === "true" || source.blocked === "on"
      };
    }
  }
  return settings;
}

async function getZoneSettings(date) {
  const allSettings = await readJson(zoneSettingsFile, {});
  return normalizeZoneSettings(date, allSettings[date]);
}

function publicZoneSettings(settings) {
  const zones = {};
  for (const room of ZONE_ROOMS) {
    zones[room] = {};
    for (const period of ZONE_PERIODS) {
      const rule = settings?.zones?.[room]?.[period] || {};
      zones[room][period] = {
        limit: Number(rule.limit || 0),
        blocked: Boolean(rule.blocked)
      };
    }
  }
  return { zones };
}

function roomKey(room) {
  const value = String(room || "").trim().toLowerCase();
  if (value === "ristorante" || value === "ristorante esterno") return "ristorante";
  return value;
}

function zoneOccupancy(bookings, booking) {
  const period = mealPeriod(booking.time);
  const targetRoom = roomKey(booking.room);
  return bookings
    .filter((item) => item.date === booking.date)
    .filter((item) => item.status !== "annullata")
    .filter((item) => roomKey(item.room) === targetRoom)
    .filter((item) => mealPeriod(item.time) === period)
    .reduce((total, item) => total + Number(item.people || 0), 0);
}

function publicSlotBookingCount(bookings, booking) {
  return bookings
    .filter((item) => item.date === booking.date)
    .filter((item) => item.status !== "annullata")
    .filter((item) => item.time === booking.time)
    .length;
}

function publicSlotError(booking, bookings) {
  const language = normalizeLanguage(booking.language);
  const now = romeNowParts();
  const bookingMinutes = clockTimeToMinutes(booking.time);
  if (booking.date < now.date || (booking.date === now.date && bookingMinutes !== null && bookingMinutes <= now.minutes)) {
    return language === "en" ? "Choose a future time slot." : "Scegli una fascia oraria futura.";
  }
  const consumption = booking.room === "Bar" ? "aperitivo" : "cena";
  const allowedTimes = new Set(publicSlotTimes(consumption));
  if (!allowedTimes.has(booking.time)) {
    return language === "en" ? "Choose one of the available time slots." : "Scegli una delle fasce orarie disponibili.";
  }
  if (publicSlotBookingCount(bookings, booking) >= PUBLIC_SLOT_MAX_BOOKINGS) {
    return language === "en" ? "This time slot is no longer available. Choose another time." : "Questa fascia oraria non e piu disponibile. Scegli un altro orario.";
  }
  return "";
}

async function publicZoneError(booking, bookings) {
  if (!ZONE_ROOMS.includes(booking.room)) return "";
  const language = normalizeLanguage(booking.language);
  const settings = await getZoneSettings(booking.date);
  const period = mealPeriod(booking.time);
  const rule = settings.zones[booking.room][period];
  const periodLabel = language === "en" ? (period === "evening" ? "evening" : "daytime") : (period === "evening" ? "serale" : "diurna");
  const roomName = emailRoomName(booking.room, language);
  if (rule.blocked) return language === "en" ? `${roomName} is not available for the ${periodLabel} service.` : `${booking.room} non e disponibile nella fascia ${periodLabel}.`;
  const occupied = zoneOccupancy(bookings, booking);
  if (rule.limit > 0 && occupied + booking.people > rule.limit) {
    return language === "en" ? `${roomName} does not have enough availability for the ${periodLabel} service.` : `${booking.room} non ha abbastanza disponibilita nella fascia ${periodLabel}.`;
  }
  return "";
}

async function publicBookingSlots(input, bookings) {
  const language = normalizeLanguage(input.language);
  const date = normalizeDate(input.date);
  const people = Number(input.people || 0);
  const consumption = sanitizeText(input.consumption, 20).toLowerCase();
  const gardenRequested = input.gardenRequested === true || input.gardenRequested === "on" || input.gardenRequested === "true";
  const allowedConsumptions = new Set(["cena", "aperitivo"]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !allowedConsumptions.has(consumption) || !Number.isInteger(people) || people < 1 || people > 40) {
    return { ok: false, error: language === "en" ? "Enter date, type of visit and number of guests." : "Inserisci data, tipo di consumazione e numero di persone." };
  }
  if (gardenRequested && consumption !== "cena") {
    return { ok: false, error: language === "en" ? "The garden can only be requested for lunch/dinner." : "Il giardino si puo richiedere solo per pranzo/cena." };
  }

  const room = consumption === "aperitivo" ? "Bar" : gardenRequested ? "Giardino" : RESTAURANT_ROOM;
  const slots = [];
  for (const time of publicSlotTimes(consumption)) {
    const draft = { date, time, people, room, language };
    const zoneError = await publicZoneError(draft, bookings);
    const slotError = publicSlotError(draft, bookings);
    if (!zoneError && !slotError) slots.push({ time });
  }
  return { ok: true, date, room, slots };
}

async function publicBookingAutomation(booking, bookings) {
  if (!ZONE_ROOMS.includes(booking.room)) {
    return {
      ...booking,
      status: "da verificare",
      notes: appendBookingNote(booking, "Automazione: sala non gestibile automaticamente, verifica manuale richiesta.")
    };
  }

  if (booking.customerNotes) {
    return {
      ...booking,
      status: "da verificare",
      notes: appendBookingNote(booking, "Automazione: note cliente presenti, verifica manuale richiesta.")
    };
  }

  const settings = await getZoneSettings(booking.date);
  const period = mealPeriod(booking.time);
  const rule = settings.zones[booking.room][period];
  const occupied = zoneOccupancy(bookings, booking);
  const projected = occupied + Number(booking.people || 0);
  const limit = Number(rule.limit || 0);

  if (rule.blocked) {
    return {
      ...booking,
      status: "da verificare",
      notes: appendBookingNote(booking, "Automazione: zona bloccata, verifica manuale richiesta.")
    };
  }

  if (limit > 0 && projected > Math.floor(limit * PUBLIC_AUTO_CONFIRM_LIMIT_RATIO)) {
    return {
      ...booking,
      status: "da verificare",
      notes: appendBookingNote(booking, `Automazione: soglia 85% quasi raggiunta (${projected}/${limit} coperti), conferma manuale richiesta.`)
    };
  }

  return {
    ...booking,
    status: "confermata",
    notes: appendBookingNote(booking, `Automazione: prenotazione confermata automaticamente (${projected}/${limit || "senza limite"} coperti).`)
  };
}

function eraseDeletedBookingPersonalData(log, actor) {
  return {
    ...log,
    personalDataErasedAt: new Date().toISOString(),
    personalDataErasedBy: actor,
    booking: {
      ...(log.booking || {}),
      guestName: "Dati rimossi",
      phone: "",
      email: "",
      notes: "",
      privacyAcceptedAt: "",
      privacyVersion: ""
    }
  };
}

function publicClientKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function emailRoomName(room, language) {
  if (language !== "en") return room;
  if (room === RESTAURANT_ROOM || room === LEGACY_RESTAURANT_ROOM) return "Outdoor Restaurant";
  if (room === "Giardino") return "Garden";
  if (room === "Interno") return "Indoor";
  return room;
}

function emailSeatLine(booking, language) {
  const room = booking.room ? `${language === "en" ? "" : "Sala "}${emailRoomName(booking.room, language)}` : "";
  const table = booking.tableNumber ? `${language === "en" ? "Table" : "Tavolo"} ${booking.tableNumber}` : "";
  return [room, table].filter(Boolean).join(" - ");
}

function bookingEmailSubject(booking) {
  const language = normalizeLanguage(booking.language);
  return language === "en" ? `Booking confirmed - ${BRAND_CONFIG.name}` : `Prenotazione confermata - ${BRAND_CONFIG.name}`;
}

function bookingCancellationEmailSubject(booking) {
  const language = normalizeLanguage(booking.language);
  return language === "en" ? `Booking cancelled - ${BRAND_CONFIG.name}` : `Prenotazione annullata - ${BRAND_CONFIG.name}`;
}

function bookingDateTimeMs(booking) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(booking.date || "")) || !/^\d{2}:\d{2}$/.test(String(booking.time || ""))) return NaN;
  return new Date(`${booking.date}T${booking.time}:00+02:00`).getTime();
}

function shouldSendCancellationEmail(booking, now = new Date()) {
  const bookingTime = bookingDateTimeMs(booking);
  if (!Number.isFinite(bookingTime)) return false;
  return now.getTime() - bookingTime < 2 * 60 * 60 * 1000;
}

function bookingCancellationText(booking) {
  const language = normalizeLanguage(booking.language);
  const seat = emailSeatLine(booking, language);
  if (language === "en") {
    return [
      `Hi ${booking.guestName},`,
      "",
      `Your booking at ${BRAND_CONFIG.name} has been cancelled.`,
      "",
      `Date: ${booking.date}`,
      `Time: ${booking.time}`,
      `Guests: ${booking.people}`,
      seat ? `Area: ${seat}` : "",
      "",
      "For any questions or new requests, you can reply to this email.",
      "",
      `The ${BRAND_CONFIG.name} Team`
    ].filter(Boolean).join("\n");
  }
  return [
    `Ciao ${booking.guestName},`,
    "",
    `La tua prenotazione da ${BRAND_CONFIG.name} è stata annullata.`,
    "",
    `Data: ${booking.date}`,
    `Ora: ${booking.time}`,
    `Persone: ${booking.people}`,
    seat ? `Zona: ${seat}` : "",
    "",
    "Per qualsiasi domanda o nuova richiesta puoi rispondere a questa email.",
    "",
    `Lo Staff del ${BRAND_CONFIG.name}`
  ].filter(Boolean).join("\n");
}

function bookingConfirmationText(booking) {
  const language = normalizeLanguage(booking.language);
  const seat = emailSeatLine(booking, language);
  const eventLines = specialEventEmailLines(booking, language);
  const gardenRequested = String(booking.notes || "").toLowerCase().includes("richiesta giardino");
  const confirmedAwayFromGarden = gardenRequested && String(booking.room || "").trim().toLowerCase() !== "giardino";
  const gardenChangeLine = confirmedAwayFromGarden
    ? language === "en"
      ? `You requested the garden, but it is currently fully booked. We have reserved the ${emailRoomName(booking.room, language) || "assigned"} area for you.`
      : `Avevi richiesto il giardino, ma in questo momento è al completo. Vi abbiamo comunque riservato la zona ${booking.room || "indicata"}.`
    : "";
  if (language === "en") {
    return [
      `Hi ${booking.guestName},`,
      "",
      `Your booking at ${BRAND_CONFIG.name} is confirmed.`,
      gardenChangeLine,
      "",
      `Date: ${booking.date}`,
      `Time: ${booking.time}`,
      `Guests: ${booking.people}`,
      seat ? `Area: ${seat}` : "",
      `Address: ${VENUE_ADDRESS}`,
      `Map: ${VENUE_MAP_URL}`,
      ...eventLines,
      "",
      "Important note:",
      "- Due to the imbalance between indoor and outdoor seating, in case of rain we cannot guarantee that the booking can be moved to a sheltered area.",
      "- The reinforced aperitif with boards, fried bites and pinse is served until 8:30 pm in the platform area with bar service. After that time, due to the size of the kitchen, the kitchen is dedicated exclusively to restaurant service; the bar continues to serve drinks, but no food for the aperitif area.",
      "- The table will be held for a maximum of 30 minutes. Any delays can be communicated to 3288123575.",
      "- If you need to CHANGE or CANCEL your booking, you can do so by replying to this email.",
      "",
      "See you soon!",
      `The ${BRAND_CONFIG.name} Team`
    ].filter(Boolean).join("\n");
  }
  return [
    `Ciao ${booking.guestName},`,
    "",
    `La tua prenotazione da ${BRAND_CONFIG.name} è confermata.`,
    gardenChangeLine,
    "",
    `Data: ${booking.date}`,
    `Ora: ${booking.time}`,
    `Persone: ${booking.people}`,
    seat ? `Zona: ${seat}` : "",
    `Indirizzo: ${VENUE_ADDRESS}`,
    `Mappa: ${VENUE_MAP_URL}`,
    ...eventLines,
    "",
    "Nota importante:",
    "- Visto lo squilibrio tra le sedute interne ed esterne, in caso di pioggia non garantiamo di poter spostare la prenotazione in area protetta.",
    "- L'aperitivo rinforzato con taglieri, frittini e pinse viene servito fino alle 20.30 nella zona della pedana con servizio bar. Dopo quell'orario la cucina si occupa esclusivamente del servizio ristorante; il bar continua a servire drink, ma non cibo per la zona aperitivo.",
    "- Il tavolo verrà tenuto per un massimo di 30 minuti. Eventuali ritardi possono essere comunicati al 3288123575.",
    "- Se hai necessità di MODIFICARE o CANCELLARE la prenotazione puoi farlo rispondendo a questa email.",
    "",
    "A presto!",
    `Lo Staff del ${BRAND_CONFIG.name}`
  ].filter(Boolean).join("\n");
}

function specialEventEmailLines(booking, language) {
  if (booking.date !== SPECIAL_EVENT_DATE) return [];
  if (language === "en") {
    return [
      "",
      `Special event: ${SPECIAL_EVENT_NAME}`,
      `Dinner & Jazz on 22 July from ${SPECIAL_EVENT_TIME}. Event menu at ${SPECIAL_EVENT_PRICE.replace("a persona", "per person").replace("bevande escluse", "drinks excluded")}.`,
      "Menu: Grand Marnier flambéed prawn with potato purée and chive oil; linguine with clams and bottarga; cheese cake.",
      "Booking required."
    ];
  }
  return [
    "",
    `Evento speciale: ${SPECIAL_EVENT_NAME}`,
    `Cena & Jazz il 22 luglio dalle ${SPECIAL_EVENT_TIME}. Menu evento a ${SPECIAL_EVENT_PRICE}.`,
    `Menu: ${SPECIAL_EVENT_MENU}`,
    "Prenotazione obbligatoria."
  ];
}

function extractEmailAddress(value) {
  const match = String(value || "").match(/<([^>]+)>/);
  return (match ? match[1] : String(value || "")).trim();
}

function encodeEmailHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value || ""), "utf8").toString("base64")}?=`;
}

function smtpReady() {
  return Boolean(EMAIL_FROM && SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS);
}

function emailMessage({ to, subject, text, html }) {
  const boundary = `muretto-${randomToken(12)}`;
  const body = html ? [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    `--${boundary}--`
  ].join("\r\n") : text;
  return [
    `From: ${EMAIL_FROM}`,
    `To: ${to}`,
    `Subject: ${encodeEmailHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    html ? `Content-Type: multipart/alternative; boundary="${boundary}"` : "Content-Type: text/plain; charset=UTF-8",
    ...(html ? [] : ["Content-Transfer-Encoding: 8bit"]),
    "",
    body
  ].join("\r\n").replace(/^\./gm, "..") + "\r\n";
}

function smtpMessage(booking) {
  return emailMessage({
    to: booking.email,
    subject: bookingEmailSubject(booking),
    text: bookingConfirmationText(booking)
  });
}

async function smtpSendCommand(socket, command, expectedCodes, state) {
  if (command) socket.write(`${command}\r\n`);
  while (true) {
    const line = await smtpReadLine(socket, state);
    const match = line.match(/^(\d{3})([ -])/);
    if (!match) continue;
    if (match[2] === "-") continue;
    const code = Number(match[1]);
    if (!expectedCodes.includes(code)) {
      throw new Error(`SMTP ${code}: ${line}`);
    }
    return line;
  }
}

function smtpReadLine(socket, state) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("Connessione SMTP chiusa"));
    };
    const takeLine = () => {
      const index = state.buffer.indexOf("\n");
      if (index === -1) return false;
      const line = state.buffer.slice(0, index + 1).trimEnd();
      state.buffer = state.buffer.slice(index + 1);
      cleanup();
      resolve(line);
      return true;
    };
    const onData = (chunk) => {
      state.buffer += chunk.toString("utf8");
      takeLine();
    };
    if (takeLine()) return;
    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("end", onEnd);
  });
}

async function sendBookingConfirmationSmtp(booking) {
  const fromAddress = extractEmailAddress(EMAIL_FROM);
  const socket = tls.connect({
    host: SMTP_HOST,
    port: SMTP_PORT,
    servername: SMTP_HOST,
    rejectUnauthorized: true
  });
  const state = { buffer: "" };
  try {
    await new Promise((resolve, reject) => {
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
    });
    await smtpSendCommand(socket, "", [220], state);
    await smtpSendCommand(socket, `EHLO ${SMTP_HOST}`, [250], state);
    await smtpSendCommand(socket, "AUTH LOGIN", [334], state);
    await smtpSendCommand(socket, Buffer.from(SMTP_USER, "utf8").toString("base64"), [334], state);
    await smtpSendCommand(socket, Buffer.from(SMTP_PASS, "utf8").toString("base64"), [235], state);
    await smtpSendCommand(socket, `MAIL FROM:<${fromAddress}>`, [250], state);
    await smtpSendCommand(socket, `RCPT TO:<${booking.email}>`, [250, 251], state);
    await smtpSendCommand(socket, "DATA", [354], state);
    await smtpSendCommand(socket, `${smtpMessage(booking)}.`, [250], state);
    await smtpSendCommand(socket, "QUIT", [221], state).catch(() => {});
    return { sent: true };
  } finally {
    socket.end();
  }
}

async function sendPlainSmtpEmail({ to, subject, text, html }) {
  const fromAddress = extractEmailAddress(EMAIL_FROM);
  const socket = tls.connect({
    host: SMTP_HOST,
    port: SMTP_PORT,
    servername: SMTP_HOST,
    rejectUnauthorized: true
  });
  const state = { buffer: "" };
  try {
    await new Promise((resolve, reject) => {
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
    });
    await smtpSendCommand(socket, "", [220], state);
    await smtpSendCommand(socket, `EHLO ${SMTP_HOST}`, [250], state);
    await smtpSendCommand(socket, "AUTH LOGIN", [334], state);
    await smtpSendCommand(socket, Buffer.from(SMTP_USER, "utf8").toString("base64"), [334], state);
    await smtpSendCommand(socket, Buffer.from(SMTP_PASS, "utf8").toString("base64"), [235], state);
    await smtpSendCommand(socket, `MAIL FROM:<${fromAddress}>`, [250], state);
    await smtpSendCommand(socket, `RCPT TO:<${to}>`, [250, 251], state);
    await smtpSendCommand(socket, "DATA", [354], state);
    await smtpSendCommand(socket, `${emailMessage({ to, subject, text, html })}.`, [250], state);
    await smtpSendCommand(socket, "QUIT", [221], state).catch(() => {});
    return { sent: true };
  } finally {
    socket.end();
  }
}

async function sendPlainEmail({ to, subject, text, html }) {
  if (!to || !EMAIL_FROM) return { sent: false, reason: "email_not_configured" };
  if (smtpReady()) return sendPlainSmtpEmail({ to, subject, text, html });
  if (!RESEND_API_KEY) return { sent: false, reason: "email_not_configured" };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      subject,
      text,
      ...(html ? { html } : {})
    })
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Invio email non riuscito: ${response.status} ${details}`.trim());
  }
  return { sent: true };
}

async function sendBookingConfirmationEmail(booking) {
  if (!booking.email || !EMAIL_FROM) {
    return { sent: false, reason: "email_not_configured" };
  }
  if (smtpReady()) return sendBookingConfirmationSmtp(booking);
  if (!RESEND_API_KEY) return { sent: false, reason: "email_not_configured" };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [booking.email],
      subject: bookingEmailSubject(booking),
      text: bookingConfirmationText(booking)
    })
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Invio email non riuscito: ${response.status} ${details}`.trim());
  }
  return { sent: true };
}

async function markConfirmationEmailIfNeeded(previousBooking, booking, actor) {
  const wasConfirmed = previousBooking?.status === "confermata";
  const isConfirmed = booking.status === "confermata";
  if (!isConfirmed || wasConfirmed || !booking.email || booking.confirmationEmailSentAt) return booking;

  try {
    const result = await sendBookingConfirmationEmail(booking);
    if (!result.sent) return booking;
    return {
      ...booking,
      confirmationEmailSentAt: new Date().toISOString(),
      confirmationEmailSentBy: actor,
      confirmationEmailError: ""
    };
  } catch (error) {
    console.error(error);
    return {
      ...booking,
      confirmationEmailError: "Invio conferma email non riuscito"
    };
  }
}

async function markCancellationEmailIfNeeded(previousBooking, booking, actor) {
  const wasCancelled = previousBooking?.status === "annullata";
  const isCancelled = booking.status === "annullata";
  if (!isCancelled || wasCancelled || !booking.email || booking.cancellationEmailSentAt) return booking;

  if (!shouldSendCancellationEmail(booking)) {
    return {
      ...booking,
      notes: appendBookingNote(booking, "Prenotazione annullata: email al cliente non inviata perché sono passate più di 2 ore dall'orario della prenotazione."),
      cancellationEmailSkippedAt: new Date().toISOString(),
      cancellationEmailSkippedReason: "oltre 2 ore dall'orario della prenotazione"
    };
  }

  try {
    const result = await sendPlainEmail({
      to: booking.email,
      subject: bookingCancellationEmailSubject(booking),
      text: bookingCancellationText(booking)
    });
    if (!result.sent) return booking;
    return {
      ...booking,
      notes: appendBookingNote(booking, `Email di annullamento inviata al cliente da ${actor}.`),
      cancellationEmailSentAt: new Date().toISOString(),
      cancellationEmailSentBy: actor,
      cancellationEmailError: ""
    };
  } catch (error) {
    console.error(error);
    return {
      ...booking,
      cancellationEmailError: "Invio annullamento email non riuscito"
    };
  }
}

function publicBookingNotificationText(booking) {
  const seat = emailSeatLine(booking, "it");
  const eventLines = specialEventEmailLines(booking, "it");
  const needsAttention = booking.status !== "confermata";
  const adminLinks = adminBookingActionLinks(booking);
  return [
    needsAttention ? "ATTENZIONE: prenotazione ricevuta dal modulo online da gestire." : "Nuova prenotazione ricevuta dal modulo online.",
    "",
    `Cliente: ${booking.guestName}`,
    `Data prenotazione: ${booking.date}`,
    `Ora: ${booking.time}`,
    `Persone: ${booking.people}`,
    seat ? `Zona proposta: ${seat}` : "",
    booking.phone ? `Telefono: ${booking.phone}` : "",
    booking.email ? `Email cliente: ${booking.email}` : "",
    booking.notes ? `Note: ${booking.notes}` : "",
    ...eventLines,
    "",
    `Ricevuta il: ${booking.createdAt}`,
    `Stato iniziale: ${booking.status}`,
    needsAttention && adminLinks.approve ? "" : "",
    needsAttention && adminLinks.approve ? `Approva prenotazione: ${adminLinks.approve}` : "",
    "",
    needsAttention ? "Apri il pannello admin per verificare, rispondere o confermare la prenotazione." : "Prenotazione confermata automaticamente. Controlla il pannello admin se servono modifiche."
  ].filter(Boolean).join("\n");
}

function adminBookingActionLinks(booking) {
  const token = encodeURIComponent(booking.adminActionToken || "");
  const id = encodeURIComponent(booking.id || "");
  return {
    approve: token && id ? `${PUBLIC_BASE_URL}/api/admin-booking-action?action=approve&id=${id}&token=${token}` : ""
  };
}

function publicBookingNotificationHtml(booking) {
  const seat = emailSeatLine(booking, "it");
  const eventLines = specialEventEmailLines(booking, "it");
  const needsAttention = booking.status !== "confermata";
  const adminLinks = adminBookingActionLinks(booking);
  return `<!doctype html>
<html lang="it">
  <body style="margin:0;padding:0;background:#f7f4ed;font-family:Arial,sans-serif;color:#1f2320;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <div style="background:#ffffff;border:1px solid #ded8ce;border-radius:8px;padding:22px;">
        <p style="margin:0 0 14px;font-weight:700;">${escapeHtml(needsAttention ? "ATTENZIONE: prenotazione ricevuta dal modulo online da gestire." : "Nuova prenotazione ricevuta dal modulo online.")}</p>
        <p style="margin:0;line-height:1.5;">
          Cliente: ${escapeHtml(booking.guestName)}<br>
          Data prenotazione: ${escapeHtml(booking.date)}<br>
          Ora: ${escapeHtml(booking.time)}<br>
          Persone: ${escapeHtml(booking.people)}<br>
          ${seat ? `Zona proposta: ${escapeHtml(seat)}<br>` : ""}
          ${booking.phone ? `Telefono: ${escapeHtml(booking.phone)}<br>` : ""}
          ${booking.email ? `Email cliente: ${escapeHtml(booking.email)}<br>` : ""}
          ${booking.notes ? `Note: ${escapeHtml(booking.notes)}<br>` : ""}
          ${eventLines.length ? `${eventLines.map(escapeHtml).join("<br>")}<br>` : ""}
          Ricevuta il: ${escapeHtml(booking.createdAt)}<br>
          Stato iniziale: ${escapeHtml(booking.status)}
        </p>
        ${needsAttention && adminLinks.approve ? `
        <p style="margin:20px 0 0;">
          <a href="${escapeHtml(adminLinks.approve)}" style="display:inline-block;padding:12px 16px;border-radius:6px;background:#2f6f5e;color:#ffffff;text-decoration:none;font-weight:700;">Approva prenotazione</a>
        </p>
        <p style="margin:10px 0 0;color:#6d756f;font-size:13px;line-height:1.4;">Il pulsante conferma la prenotazione e invia la mail di conferma al cliente.</p>` : `
        <p style="margin:18px 0 0;color:#6d756f;font-size:13px;line-height:1.4;">Prenotazione confermata automaticamente. Controlla il pannello admin se servono modifiche.</p>`}
      </div>
    </div>
  </body>
</html>`;
}

async function markPublicBookingNotification(booking) {
  try {
    const needsAttention = booking.status !== "confermata";
    const bookingForNotification = needsAttention && !booking.adminActionToken
      ? { ...booking, adminActionToken: randomToken(24) }
      : booking;
    const result = await sendPlainEmail({
      to: NOTIFICATION_EMAIL,
      subject: needsAttention ? `ATTENZIONE: Prenotazione da gestire - ${BRAND_CONFIG.name}` : `Nuova prenotazione confermata automaticamente - ${BRAND_CONFIG.name}`,
      text: publicBookingNotificationText(bookingForNotification),
      html: publicBookingNotificationHtml(bookingForNotification)
    });
    if (!result.sent) return bookingForNotification;
    return {
      ...bookingForNotification,
      notificationEmailSentAt: new Date().toISOString(),
      notificationEmailTo: NOTIFICATION_EMAIL,
      notificationEmailError: ""
    };
  } catch (error) {
    console.error(error);
    return {
      ...booking,
      notificationEmailError: "Invio notifica email non riuscito"
    };
  }
}

function voiceBookingNotificationText(booking) {
  const seat = emailSeatLine(booking, "it");
  return [
    "Nuova prenotazione ricevuta dalla segreteria telefonica.",
    "",
    `Cliente: ${booking.guestName}`,
    `Data prenotazione: ${booking.date}`,
    `Ora: ${booking.time}`,
    `Persone: ${booking.people}`,
    seat ? `Zona: ${seat}` : "",
    booking.phone ? `Telefono: ${booking.phone}` : "",
    booking.email ? `Email cliente: ${booking.email}` : "",
    booking.notes ? `Note: ${booking.notes}` : "",
    "",
    `Ricevuta il: ${booking.createdAt}`,
    `Stato: ${booking.status}`,
    "",
    "Origine: segreteria telefonica automatica."
  ].filter(Boolean).join("\n");
}

async function markVoiceBookingNotification(booking) {
  try {
    const result = await sendPlainEmail({
      to: NOTIFICATION_EMAIL,
      subject: `Prenotazione telefonica ricevuta - ${BRAND_CONFIG.name}`,
      text: voiceBookingNotificationText(booking)
    });
    if (!result.sent) return booking;
    return {
      ...booking,
      notificationEmailSentAt: new Date().toISOString(),
      notificationEmailTo: NOTIFICATION_EMAIL,
      notificationEmailError: ""
    };
  } catch (error) {
    console.error(error);
    return {
      ...booking,
      notificationEmailError: "Invio notifica segreteria non riuscito"
    };
  }
}

function customerActionNotificationText(booking, action, details = {}) {
  const seat = emailSeatLine(booking, "it");
  const isConfirm = action === "confirm";
  const isTimeChoice = action === "time";
  const actionLine = isTimeChoice
    ? `Il cliente ha scelto l'orario ${details.selectedTime} tramite il pulsante ricevuto via email.`
    : `Il cliente ha ${isConfirm ? "confermato" : "annullato"} la prenotazione tramite il pulsante ricevuto via email.`;
  const resultLine = isTimeChoice ? `ORARIO SCELTO: ${details.selectedTime}` : (isConfirm ? "CONFERMATA" : "ANNULLATA");
  return [
    actionLine,
    "",
    `Esito: ${resultLine}`,
    `Cliente: ${booking.guestName}`,
    `Data prenotazione: ${booking.date}`,
    `Ora: ${booking.time}`,
    `Persone: ${booking.people}`,
    seat ? `Zona: ${seat}` : "",
    booking.phone ? `Telefono: ${booking.phone}` : "",
    booking.email ? `Email cliente: ${booking.email}` : "",
    booking.notes ? `Note: ${booking.notes}` : "",
    "",
    `Azione registrata il: ${booking.customerActionAt || new Date().toISOString()}`
  ].filter(Boolean).join("\n");
}

async function markCustomerActionNotification(booking, action, details = {}) {
  try {
    const actionLabel = action === "confirm" ? "confermata" : action === "cancel" ? "annullata" : "orario scelto";
    const result = await sendPlainEmail({
      to: NOTIFICATION_EMAIL,
      subject: `Prenotazione ${actionLabel} dal cliente - ${BRAND_CONFIG.name}`,
      text: customerActionNotificationText(booking, action, details)
    });
    if (!result.sent) return booking;
    return {
      ...booking,
      customerActionNotificationSentAt: new Date().toISOString(),
      customerActionNotificationTo: NOTIFICATION_EMAIL,
      customerActionNotificationError: ""
    };
  } catch (error) {
    console.error(error);
    return {
      ...booking,
      customerActionNotificationError: "Invio notifica azione cliente non riuscito"
    };
  }
}

function customerMessageEmailText(booking, message, proposedTimes = []) {
  const seat = emailSeatLine(booking, normalizeLanguage(booking.language));
  const links = bookingActionLinks(booking);
  const timeLinks = bookingTimeChoiceLinks(booking, proposedTimes);
  return [
    message,
    timeLinks.length ? "" : "",
    timeLinks.length ? "Scegli un orario usando uno di questi link:" : "",
    ...timeLinks.map((item) => `${item.time}: ${item.url}`),
    "",
    "Puoi confermare o annullare anche fino a un'ora prima della prenotazione:",
    `Conferma: ${links.confirm}`,
    `Annulla: ${links.cancel}`,
    "",
    "---",
    "Riepilogo richiesta:",
    `Cliente: ${booking.guestName}`,
    `Data: ${booking.date}`,
    `Ora: ${booking.time}`,
    `Persone: ${booking.people}`,
    seat ? `Zona: ${seat}` : "",
    booking.notes ? `Note: ${booking.notes}` : ""
  ].filter(Boolean).join("\n");
}

function bookingActionLinks(booking) {
  const token = encodeURIComponent(booking.customerActionToken || "");
  const id = encodeURIComponent(booking.id || "");
  return {
    confirm: `${PUBLIC_BASE_URL}/api/booking-action?action=confirm&id=${id}&token=${token}`,
    cancel: `${PUBLIC_BASE_URL}/api/booking-action?action=cancel&id=${id}&token=${token}`
  };
}

function bookingTimeChoiceLinks(booking, proposedTimes = []) {
  const token = encodeURIComponent(booking.customerActionToken || "");
  const id = encodeURIComponent(booking.id || "");
  return proposedTimes.map((time) => ({
    time,
    url: `${PUBLIC_BASE_URL}/api/booking-action?action=time&id=${id}&token=${token}&time=${encodeURIComponent(time)}`
  }));
}

function customerMessageEmailHtml(booking, message, proposedTimes = []) {
  const seat = emailSeatLine(booking, normalizeLanguage(booking.language));
  const links = bookingActionLinks(booking);
  const timeLinks = bookingTimeChoiceLinks(booking, proposedTimes);
  const paragraphs = escapeHtml(message).split(/\n{2,}/).map((part) => `<p>${part.replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html>
<html lang="it">
  <body style="margin:0;padding:0;background:#f7f4ed;font-family:Arial,sans-serif;color:#1f2320;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <div style="background:#ffffff;border:1px solid #ded8ce;border-radius:8px;padding:22px;">
        ${paragraphs}
        ${timeLinks.length ? `
        <p style="margin:18px 0 10px;font-weight:700;">Scegli un orario</p>
        <p style="margin:0 0 20px;">
          ${timeLinks.map((item) => `<a href="${escapeHtml(item.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 16px;border-radius:6px;background:#1f4e42;color:#ffffff;text-decoration:none;font-weight:700;">${escapeHtml(item.time)}</a>`).join("")}
        </p>` : ""}
        <p style="margin:18px 0 10px;font-weight:700;">Puoi confermare o annullare anche fino a un'ora prima della prenotazione.</p>
        <p style="margin:0 0 20px;">
          <a href="${escapeHtml(links.confirm)}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 16px;border-radius:6px;background:#2f6f5e;color:#ffffff;text-decoration:none;font-weight:700;">Conferma prenotazione</a>
          <a href="${escapeHtml(links.cancel)}" style="display:inline-block;margin:0 0 8px 0;padding:12px 16px;border-radius:6px;background:#b25f3a;color:#ffffff;text-decoration:none;font-weight:700;">Annulla prenotazione</a>
        </p>
        <hr style="border:0;border-top:1px solid #ded8ce;margin:18px 0;">
        <p style="margin:0 0 6px;font-weight:700;">Riepilogo richiesta</p>
        <p style="margin:0;line-height:1.5;">
          Cliente: ${escapeHtml(booking.guestName)}<br>
          Data: ${escapeHtml(booking.date)}<br>
          Ora: ${escapeHtml(booking.time)}<br>
          Persone: ${escapeHtml(booking.people)}<br>
          ${seat ? `Zona: ${escapeHtml(seat)}<br>` : ""}
          ${booking.notes ? `Note: ${escapeHtml(booking.notes)}` : ""}
        </p>
      </div>
    </div>
  </body>
</html>`;
}

function allowPublicBookingAttempt(req) {
  const key = publicClientKey(req);
  const now = Date.now();
  const attempts = (publicBookingAttempts.get(key) || []).filter((time) => now - time < PUBLIC_BOOKING_WINDOW_MS);
  if (attempts.length >= PUBLIC_BOOKING_MAX_ATTEMPTS) {
    publicBookingAttempts.set(key, attempts);
    return false;
  }
  attempts.push(now);
  publicBookingAttempts.set(key, attempts);
  return true;
}

function requireAdmin(session, res) {
  if (session.role !== "admin") {
    sendJson(res, 403, { error: "Solo un amministratore puo gestire lo staff" });
    return false;
  }
  return true;
}

function requireBookingEditor(session, res) {
  if (!["admin", "staff"].includes(session.role)) {
    sendJson(res, 403, { error: "Questo accesso puo consultare solo l'agenda" });
    return false;
  }
  return true;
}

function requireAgendaTableEditor(session, res) {
  if (!["admin", "staff", "agenda"].includes(session.role)) {
    sendJson(res, 403, { error: "Accesso non autorizzato" });
    return false;
  }
  return true;
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/login" && req.method === "POST") {
    const body = await readBody(req);
    const name = normalizeName(body.name);
    const pin = String(body.pin || "");
    if (!name || !pinIsValid(pin)) {
      sendJson(res, 400, { error: "Nome o PIN non valido" });
      return;
    }

    const employees = await readJson(employeesFile, []);
    const employee = employees.find((item) => item.active && item.name.toLowerCase() === name.toLowerCase());
    if (!employee || !(await verifyPin(pin, employee))) {
      sendJson(res, 401, { error: "Credenziali non corrette" });
      return;
    }

    const token = randomToken();
    const session = {
      employeeId: employee.id,
      employeeName: employee.name,
      role: employee.role,
      csrfToken: randomToken(24),
      expiresAt: Date.now() + SESSION_TTL_MS
    };
    sessions.set(hashValue(token), session);
    res.writeHead(200, {
      ...jsonHeaders,
      ...securityHeaders,
      "set-cookie": sessionCookie(token)
    });
    res.end(JSON.stringify({ employee: { name: employee.name, role: employee.role }, csrfToken: session.csrfToken }));
    return;
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    const token = parseCookies(req).muretto_session;
    if (token) sessions.delete(hashValue(token));
    res.writeHead(200, { ...jsonHeaders, ...securityHeaders, "set-cookie": clearSessionCookie() });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === "/api/me" && req.method === "GET") {
    const session = getSession(req);
    if (!session) {
      sendJson(res, 200, { employee: null });
      return;
    }
    sendJson(res, 200, { employee: { name: session.employeeName, role: session.role }, csrfToken: session.csrfToken });
    return;
  }

  if (url.pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/config" && req.method === "GET") {
    sendJson(res, 200, { brand: BRAND_CONFIG });
    return;
  }

  if (url.pathname === "/telnyx/voice" && req.method === "POST") {
    if (!tokenMatches(url.searchParams.get("token"), VOICE_API_TOKEN)) {
      sendXml(res, 401, `<?xml version="1.0" encoding="UTF-8"?><Response><Reject /></Response>`);
      return;
    }
    sendXml(res, 200, `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="${escapeHtml(TELNYX_RELAY_URL)}"
      welcomeGreeting="Ciao, hai chiamato Muretto. Sono l'assistente automatico per le prenotazioni. Ti informo che useremo i dati che mi comunichi solo per gestire la prenotazione. Dimmi pure nome, giorno, ora e numero di persone."
      voice="${escapeHtml(TELNYX_RELAY_VOICE)}"
      language="${escapeHtml(TELNYX_RELAY_LANGUAGE)}"
      transcriptionProvider="telnyx"
      dtmfDetection="true"
      interruptible="speech"
      welcomeGreetingInterruptible="speech" />
  </Connect>
  <Say>Grazie, a presto.</Say>
  <Hangup />
</Response>`);
    return;
  }

  if (url.pathname === "/api/public-booking-slots" && req.method === "GET") {
    const bookings = await readJson(bookingsFile, []);
    const result = await publicBookingSlots({
      date: url.searchParams.get("date"),
      consumption: url.searchParams.get("consumption"),
      gardenRequested: url.searchParams.get("gardenRequested"),
      people: url.searchParams.get("people"),
      language: url.searchParams.get("language")
    }, bookings);
    if (!result.ok) {
      sendJson(res, 400, { error: result.error });
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (url.pathname === "/api/public-bookings" && req.method === "POST") {
    if (!allowPublicBookingAttempt(req)) {
      sendJson(res, 429, { error: "Troppe richieste. Riprova tra qualche minuto." });
      return;
    }
    const body = await readBody(req);
    if (sanitizeText(body.website, 80)) {
      sendJson(res, 200, { ok: true });
      return;
    }
    const result = validatePublicBooking(body);
    if (typeof result === "string") {
      sendJson(res, 400, { error: result });
      return;
    }
    const bookings = await readJson(bookingsFile, []);
    const slotError = publicSlotError(result, bookings);
    if (slotError) {
      sendJson(res, 409, { error: slotError });
      return;
    }
    const zoneError = await publicZoneError(result, bookings);
    if (zoneError) {
      sendJson(res, 409, { error: zoneError });
      return;
    }
    const now = new Date().toISOString();
    let booking = {
      id: crypto.randomUUID(),
      ...result,
      createdBy: "modulo online",
      createdAt: now,
      updatedAt: now,
      updatedBy: "modulo online",
      privacyAcceptedAt: now,
      privacyVersion: PRIVACY_VERSION
    };
    booking = await publicBookingAutomation(booking, bookings);
    bookings.push(booking);
    await writeJson(bookingsFile, bookings);
    booking = await markConfirmationEmailIfNeeded(null, booking, "automazione modulo online");
    bookings[bookings.length - 1] = booking;
    await writeJson(bookingsFile, bookings);
    booking = await markPublicBookingNotification(booking);
    bookings[bookings.length - 1] = booking;
    await writeJson(bookingsFile, bookings);
    sendJson(res, 201, {
      ok: true,
      booking: {
        id: booking.id,
        date: booking.date,
        time: booking.time,
        people: booking.people,
        room: booking.room,
        status: booking.status
      }
    });
    return;
  }

  if (url.pathname === "/api/voice/availability" && req.method === "POST") {
    if (!requireVoiceApi(req, res)) return;
    const body = await readBody(req);
    const result = await voiceAvailability(body);
    sendJson(res, result.ok ? 200 : 409, result);
    return;
  }

  if (url.pathname === "/api/voice/bookings" && req.method === "POST") {
    if (!requireVoiceApi(req, res)) return;
    const body = await readBody(req);
    const result = await createVoiceBooking(body);
    sendJson(res, result.status, result.ok ? { ok: true, booking: result.booking } : { ok: false, error: result.error, availability: result.availability });
    return;
  }

  if (url.pathname === "/api/voice/callbacks" && req.method === "POST") {
    if (!requireVoiceApi(req, res)) return;
    const body = await readBody(req);
    const result = await createVoiceCallback(body);
    sendJson(res, 201, result);
    return;
  }

  if (url.pathname === "/api/booking-action" && req.method === "GET") {
    const id = sanitizeText(url.searchParams.get("id"), 80);
    const token = sanitizeText(url.searchParams.get("token"), 120);
    const action = sanitizeText(url.searchParams.get("action"), 20);
    if (!id || !token || !["confirm", "cancel", "time"].includes(action)) {
      sendHtml(res, 400, "Link non valido", "Il link usato non è valido o è incompleto.");
      return;
    }
    const bookings = await readJson(bookingsFile, []);
    const index = bookings.findIndex((item) => item.id === id && item.customerActionToken === token);
    if (index === -1) {
      sendHtml(res, 404, "Link non valido", "Non abbiamo trovato una prenotazione collegata a questo link.");
      return;
    }
    const now = new Date().toISOString();
    if (action === "time") {
      const selectedTime = normalizeClockTime(url.searchParams.get("time"));
      const proposedTimes = sanitizeProposedTimes(bookings[index].customerProposedTimes);
      const previousTime = bookings[index].time;
      if (!selectedTime || !proposedTimes.includes(selectedTime)) {
        sendHtml(res, 400, "Orario non valido", "Questo orario non è più disponibile tra le opzioni proposte.");
        return;
      }
      bookings[index] = {
        ...bookings[index],
        time: selectedTime,
        status: "da verificare",
        notes: appendBookingNote(bookings[index], `Cambio orario scelto dal cliente tramite email: da ${previousTime} a ${selectedTime}. Stato impostato a da verificare.`),
        customerActionAt: now,
        customerAction: "time",
        customerSelectedTime: selectedTime,
        updatedAt: now,
        updatedBy: "cliente: scelta orario email"
      };
      bookings[index] = await markCustomerActionNotification(bookings[index], action, { selectedTime, previousTime });
      await writeJson(bookingsFile, bookings);
      sendHtml(
        res,
        200,
        "Orario scelto",
        `Grazie, abbiamo registrato la tua preferenza per le ${selectedTime}. Ti invieremo la conferma della prenotazione.`
      );
      return;
    }
    const status = action === "confirm" ? "confermata" : "annullata";
    bookings[index] = {
      ...bookings[index],
      status,
      notes: appendBookingNote(bookings[index], action === "confirm"
        ? "Prenotazione confermata dal cliente tramite pulsante email."
        : "Prenotazione annullata dal cliente tramite pulsante email."),
      customerActionAt: now,
      customerAction: action,
      updatedAt: now,
      updatedBy: action === "confirm" ? "cliente: conferma email" : "cliente: annullo email"
    };
    bookings[index] = await markCustomerActionNotification(bookings[index], action);
    await writeJson(bookingsFile, bookings);
    sendHtml(
      res,
      200,
      action === "confirm" ? "Prenotazione confermata" : "Prenotazione annullata",
      action === "confirm"
        ? "Grazie, abbiamo registrato la tua conferma. Ti aspettiamo."
        : "Abbiamo registrato l'annullamento della prenotazione. Grazie per averci avvisato."
    );
    return;
  }

  if (url.pathname === "/api/admin-booking-action" && req.method === "GET") {
    const id = sanitizeText(url.searchParams.get("id"), 80);
    const token = sanitizeText(url.searchParams.get("token"), 120);
    const action = sanitizeText(url.searchParams.get("action"), 20);
    if (!id || !token || action !== "approve") {
      sendHtml(res, 400, "Link non valido", "Il link usato non è valido o è incompleto.");
      return;
    }
    const bookings = await readJson(bookingsFile, []);
    const index = bookings.findIndex((item) => item.id === id && item.adminActionToken === token);
    if (index === -1) {
      sendHtml(res, 404, "Link non valido", "Non abbiamo trovato una prenotazione collegata a questo link.");
      return;
    }
    if (bookings[index].status === "annullata") {
      sendHtml(res, 409, "Prenotazione annullata", "Questa prenotazione risulta annullata e non può essere approvata da questo link.");
      return;
    }
    if (bookings[index].status === "confermata") {
      sendHtml(res, 200, "Prenotazione già confermata", "Questa prenotazione era già confermata. Non sono state fatte altre modifiche.");
      return;
    }
    const previousBooking = { ...bookings[index] };
    const now = new Date().toISOString();
    bookings[index] = {
      ...bookings[index],
      status: "confermata",
      notes: appendBookingNote(bookings[index], "Prenotazione approvata dallo staff tramite pulsante email."),
      adminActionAt: now,
      adminAction: "approve",
      updatedAt: now,
      updatedBy: "staff: approvazione email"
    };
    bookings[index] = await markConfirmationEmailIfNeeded(previousBooking, bookings[index], "staff: approvazione email");
    await writeJson(bookingsFile, bookings);
    sendHtml(
      res,
      200,
      "Prenotazione approvata",
      bookings[index].confirmationEmailSentAt
        ? "Prenotazione confermata. La mail di conferma è stata inviata al cliente."
        : "Prenotazione confermata. Attenzione: la mail di conferma al cliente non risulta inviata, controlla il pannello admin."
    );
    return;
  }

  const session = requireSession(req, res);
  if (!session) return;

  if (url.pathname === "/api/agenda" && req.method === "GET") {
    const bookings = await readJson(bookingsFile, []);
    const date = normalizeDate(url.searchParams.get("date") || new Date().toISOString().slice(0, 10));
    const zoneSettings = publicZoneSettings(await getZoneSettings(date));
    const visible = bookings
      .filter((item) => item.date === date)
      .filter((item) => item.status !== "annullata")
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((item) => ({
        id: item.id,
        guestName: item.guestName,
        date: item.date,
        time: item.time,
        people: item.people,
        room: item.room || "",
        tableNumber: item.tableNumber || "",
        status: item.status,
        notes: item.notes || ""
      }));
    sendJson(res, 200, { date, bookings: visible, zoneSettings });
    return;
  }

  if (url.pathname === "/api/received-bookings" && req.method === "GET") {
    if (!requireAdmin(session, res)) return;
    const bookings = await readJson(bookingsFile, []);
    const received = bookings
      .filter((item) => item.createdBy === "modulo online")
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, 200)
      .map((item) => ({
        id: item.id,
        guestName: item.guestName,
        phone: item.phone || "",
        email: item.email || "",
        date: item.date,
        time: item.time,
        people: item.people,
        room: item.room || "",
        tableNumber: item.tableNumber || "",
        status: item.status,
        notes: item.notes || "",
        language: normalizeLanguage(item.language),
        createdAt: item.createdAt,
        notificationEmailSentAt: item.notificationEmailSentAt || "",
        notificationEmailError: item.notificationEmailError || ""
      }));
    sendJson(res, 200, { bookings: received });
    return;
  }

  if (url.pathname === "/api/employees" && req.method === "GET") {
    if (!requireAdmin(session, res)) return;
    const employees = await readJson(employeesFile, []);
    sendJson(res, 200, {
      employees: employees.map((employee) => ({
        id: employee.id,
        name: employee.name,
        role: employee.role,
        active: employee.active,
        createdAt: employee.createdAt
      }))
    });
    return;
  }

  if (url.pathname === "/api/backups" && req.method === "GET") {
    if (!requireAdmin(session, res)) return;
    sendJson(res, 200, { backups: await listBackupFiles() });
    return;
  }

  if (url.pathname === "/api/backups" && req.method === "POST") {
    if (!requireAdmin(session, res)) return;
    const backup = await createBackup("manuale", session.employeeName);
    sendJson(res, 201, { backup, downloadUrl: `/api/backups/${encodeURIComponent(backup.name)}` });
    return;
  }

  if (url.pathname === "/api/deleted-bookings" && req.method === "GET") {
    if (!requireAdmin(session, res)) return;
    const logs = await readJson(deletedBookingsFile, []);
    sendJson(res, 200, {
      logs: logs
        .slice()
        .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
        .slice(0, 100)
    });
    return;
  }

  const deletedBookingPrivacyMatch = url.pathname.match(/^\/api\/deleted-bookings\/([a-f0-9-]+)\/personal-data$/i);
  if (deletedBookingPrivacyMatch && req.method === "DELETE") {
    if (!requireAdmin(session, res)) return;
    const logs = await readJson(deletedBookingsFile, []);
    const index = logs.findIndex((item) => item.id === deletedBookingPrivacyMatch[1]);
    if (index === -1) {
      sendJson(res, 404, { error: "Log cancellazione non trovato" });
      return;
    }
    logs[index] = eraseDeletedBookingPersonalData(logs[index], session.employeeName);
    await writeJson(deletedBookingsFile, logs);
    sendJson(res, 200, { log: logs[index] });
    return;
  }

  if (url.pathname === "/api/zone-settings" && req.method === "GET") {
    if (!requireAdmin(session, res)) return;
    const date = normalizeDate(url.searchParams.get("date") || new Date().toISOString().slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      sendJson(res, 400, { error: "Data non valida" });
      return;
    }
    sendJson(res, 200, { settings: await getZoneSettings(date) });
    return;
  }

  if (url.pathname === "/api/zone-settings" && req.method === "PUT") {
    if (!requireAdmin(session, res)) return;
    const body = await readBody(req);
    const date = normalizeDate(body.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      sendJson(res, 400, { error: "Data non valida" });
      return;
    }
    const allSettings = await readJson(zoneSettingsFile, {});
    const settings = normalizeZoneSettings(date, body);
    allSettings[date] = settings.zones;
    await writeJson(zoneSettingsFile, allSettings);
    sendJson(res, 200, { settings });
    return;
  }

  const backupMatch = url.pathname.match(/^\/api\/backups\/([^/]+)$/);
  if (backupMatch && req.method === "GET") {
    if (!requireAdmin(session, res)) return;
    const fileName = decodeURIComponent(backupMatch[1]);
    if (!isBackupFileName(fileName)) {
      sendJson(res, 400, { error: "Backup non valido" });
      return;
    }
    try {
      const content = await fs.readFile(path.join(backupsDir, fileName), "utf8");
      sendDownload(res, fileName, content);
    } catch (error) {
      if (error.code === "ENOENT") sendJson(res, 404, { error: "Backup non trovato" });
      else throw error;
    }
    return;
  }

  if (url.pathname === "/api/employees" && req.method === "POST") {
    if (!requireAdmin(session, res)) return;
    const body = await readBody(req);
    const name = normalizeName(body.name);
    const pin = String(body.pin || "");
    const role = ["admin", "staff", "agenda"].includes(body.role) ? body.role : "staff";
    if (!name) {
      sendJson(res, 400, { error: "Inserisci il nome del dipendente" });
      return;
    }
    if (!pinIsValid(pin)) {
      sendJson(res, 400, { error: "Il PIN deve contenere da 4 a 12 cifre" });
      return;
    }
    const employees = await readJson(employeesFile, []);
    if (employees.some((employee) => employee.active && employee.name.toLowerCase() === name.toLowerCase())) {
      sendJson(res, 409, { error: "Esiste gia un dipendente attivo con questo nome" });
      return;
    }
    const { salt, hash } = await hashPin(pin);
    const employee = {
      id: crypto.randomUUID(),
      name,
      role,
      pinSalt: salt,
      pinHash: hash,
      active: true,
      createdAt: new Date().toISOString(),
      createdBy: session.employeeName
    };
    employees.push(employee);
    await writeJson(employeesFile, employees);
    sendJson(res, 201, { employee: { id: employee.id, name: employee.name, role: employee.role, active: true, createdAt: employee.createdAt } });
    return;
  }

  const employeeMatch = url.pathname.match(/^\/api\/employees\/([a-f0-9-]+)$/i);
  if (employeeMatch && req.method === "DELETE") {
    if (!requireAdmin(session, res)) return;
    const employees = await readJson(employeesFile, []);
    const employee = employees.find((item) => item.id === employeeMatch[1]);
    if (!employee) {
      sendJson(res, 404, { error: "Dipendente non trovato" });
      return;
    }
    if (employee.id === session.employeeId) {
      sendJson(res, 400, { error: "Non puoi disattivare il tuo accesso corrente" });
      return;
    }
    employee.active = false;
    employee.deactivatedAt = new Date().toISOString();
    employee.deactivatedBy = session.employeeName;
    await writeJson(employeesFile, employees);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/bookings" && req.method === "GET") {
    if (!requireBookingEditor(session, res)) return;
    const bookings = await readJson(bookingsFile, []);
    const from = normalizeDate(url.searchParams.get("from"));
    const to = normalizeDate(url.searchParams.get("to"));
    const zoneSettings = from && from === to ? publicZoneSettings(await getZoneSettings(from)) : null;
    const visible = bookings
      .filter((item) => !from || item.date >= from)
      .filter((item) => !to || item.date <= to)
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    sendJson(res, 200, { bookings: visible, zoneSettings });
    return;
  }

  if (url.pathname === "/api/phone-bookings" && req.method === "POST") {
    if (!requireAdmin(session, res)) return;
    const body = await readBody(req);
    const result = validatePhoneBooking(body);
    if (typeof result === "string") {
      sendJson(res, 400, { error: result });
      return;
    }
    const bookings = await readJson(bookingsFile, []);
    const now = new Date().toISOString();
    const booking = {
      id: crypto.randomUUID(),
      ...result,
      bookingChannel: "telefono",
      phonePrivacyAcceptedAt: now,
      phonePrivacyAcceptedBy: session.employeeName,
      createdBy: `telefono: ${session.employeeName}`,
      createdAt: now,
      updatedAt: now,
      updatedBy: `telefono: ${session.employeeName}`
    };
    bookings.push(booking);
    await writeJson(bookingsFile, bookings);
    sendJson(res, 201, { booking });
    return;
  }

  if (url.pathname === "/api/bookings" && req.method === "POST") {
    if (!requireBookingEditor(session, res)) return;
    const body = await readBody(req);
    const result = validateBooking(body);
    if (typeof result === "string") {
      sendJson(res, 400, { error: result });
      return;
    }
    const bookings = await readJson(bookingsFile, []);
    const now = new Date().toISOString();
    const booking = {
      id: crypto.randomUUID(),
      ...result,
      createdBy: session.employeeName,
      createdAt: now,
      updatedAt: now
    };
    bookings.push(booking);
    await writeJson(bookingsFile, bookings);
    sendJson(res, 201, { booking });
    return;
  }

  const bookingMatch = url.pathname.match(/^\/api\/bookings\/([a-f0-9-]+)$/i);
  const bookingArrivedMatch = url.pathname.match(/^\/api\/bookings\/([a-f0-9-]+)\/arrived$/i);
  if (bookingArrivedMatch && req.method === "PATCH") {
    if (!requireAgendaTableEditor(session, res)) return;
    const bookings = await readJson(bookingsFile, []);
    const index = bookings.findIndex((item) => item.id === bookingArrivedMatch[1]);
    if (index === -1) {
      sendJson(res, 404, { error: "Prenotazione non trovata" });
      return;
    }
    const now = new Date().toISOString();
    const isArrived = bookings[index].status === "arrivati";
    bookings[index] = {
      ...bookings[index],
      status: isArrived ? "confermata" : "arrivati",
      arrivedAt: isArrived ? "" : now,
      arrivedBy: isArrived ? "" : session.employeeName,
      updatedAt: now,
      updatedBy: session.employeeName
    };
    await writeJson(bookingsFile, bookings);
    sendJson(res, 200, {
      booking: {
        id: bookings[index].id,
        status: bookings[index].status,
        arrivedAt: bookings[index].arrivedAt,
        arrivedBy: bookings[index].arrivedBy
      }
    });
    return;
  }

  const bookingTableMatch = url.pathname.match(/^\/api\/bookings\/([a-f0-9-]+)\/table$/i);
  if (bookingTableMatch && req.method === "PATCH") {
    if (!requireAgendaTableEditor(session, res)) return;
    const body = await readBody(req);
    const tableNumber = sanitizeText(body.tableNumber, 30);
    const bookings = await readJson(bookingsFile, []);
    const index = bookings.findIndex((item) => item.id === bookingTableMatch[1]);
    if (index === -1) {
      sendJson(res, 404, { error: "Prenotazione non trovata" });
      return;
    }
    bookings[index] = {
      ...bookings[index],
      tableNumber,
      updatedAt: new Date().toISOString(),
      updatedBy: session.employeeName
    };
    await writeJson(bookingsFile, bookings);
    sendJson(res, 200, {
      booking: {
        id: bookings[index].id,
        tableNumber: bookings[index].tableNumber || ""
      }
    });
    return;
  }

  const bookingMessageMatch = url.pathname.match(/^\/api\/bookings\/([a-f0-9-]+)\/message$/i);
  if (bookingMessageMatch && req.method === "POST") {
    if (!requireBookingEditor(session, res)) return;
    const body = await readBody(req);
    const subject = sanitizeText(body.subject, 140);
    const message = sanitizeMessageText(body.message, 2000);
    if (!subject) {
      sendJson(res, 400, { error: "Inserisci l'oggetto del messaggio" });
      return;
    }
    if (!message) {
      sendJson(res, 400, { error: "Scrivi il messaggio da inviare" });
      return;
    }
    const bookings = await readJson(bookingsFile, []);
    const index = bookings.findIndex((item) => item.id === bookingMessageMatch[1]);
    if (index === -1) {
      sendJson(res, 404, { error: "Prenotazione non trovata" });
      return;
    }
    if (!bookings[index].email) {
      sendJson(res, 400, { error: "Questa prenotazione non ha un indirizzo email" });
      return;
    }
    const proposedTimes = sanitizeProposedTimesForBooking(body.proposedTimes, bookings[index]);
    const bookingForMessage = {
      ...bookings[index],
      customerActionToken: bookings[index].customerActionToken || randomToken(24)
    };
    const emailResult = await sendPlainEmail({
      to: bookingForMessage.email,
      subject,
      text: customerMessageEmailText(bookingForMessage, message, proposedTimes),
      html: customerMessageEmailHtml(bookingForMessage, message, proposedTimes)
    });
    if (!emailResult.sent) {
      sendJson(res, 400, { error: "Invio email non configurato" });
      return;
    }
    bookings[index] = {
      ...bookingForMessage,
      notes: appendBookingNote(bookingForMessage, proposedTimes.length
        ? `Proposta cambio orario inviata da ${session.employeeName}. Orari proposti: ${proposedTimes.join(", ")}.`
        : `Messaggio inviato al cliente da ${session.employeeName}: ${subject}.`),
      customerMessageSentAt: new Date().toISOString(),
      customerMessageSentBy: session.employeeName,
      customerMessageSubject: subject,
      customerProposedTimes: proposedTimes,
      updatedAt: new Date().toISOString(),
      updatedBy: session.employeeName
    };
    await writeJson(bookingsFile, bookings);
    sendJson(res, 200, { ok: true, booking: bookings[index] });
    return;
  }

  if (bookingMatch && req.method === "PATCH") {
    if (!requireBookingEditor(session, res)) return;
    const body = await readBody(req);
    const result = validateBooking(body);
    if (typeof result === "string") {
      sendJson(res, 400, { error: result });
      return;
    }
    const bookings = await readJson(bookingsFile, []);
    const index = bookings.findIndex((item) => item.id === bookingMatch[1]);
    if (index === -1) {
      sendJson(res, 404, { error: "Prenotazione non trovata" });
      return;
    }
    const previousBooking = bookings[index];
    const updatedBooking = await markConfirmationEmailIfNeeded(previousBooking, {
      ...previousBooking,
      ...result,
      updatedAt: new Date().toISOString(),
      updatedBy: session.employeeName
    }, session.employeeName);
    bookings[index] = await markCancellationEmailIfNeeded(previousBooking, updatedBooking, session.employeeName);
    await writeJson(bookingsFile, bookings);
    sendJson(res, 200, { booking: bookings[index] });
    return;
  }

  if (bookingMatch && req.method === "DELETE") {
    if (!requireBookingEditor(session, res)) return;
    const bookings = await readJson(bookingsFile, []);
    const booking = bookings.find((item) => item.id === bookingMatch[1]);
    if (!booking) {
      sendJson(res, 404, { error: "Prenotazione non trovata" });
      return;
    }
    const remaining = bookings.filter((item) => item.id !== bookingMatch[1]);
    const logs = await readJson(deletedBookingsFile, []);
    logs.push({
      id: crypto.randomUUID(),
      bookingId: booking.id,
      deletedAt: new Date().toISOString(),
      deletedBy: session.employeeName,
      booking: {
        guestName: booking.guestName,
        date: booking.date,
        time: booking.time,
        people: booking.people,
        room: booking.room,
        tableNumber: booking.tableNumber,
        status: booking.status,
        phone: booking.phone,
        email: booking.email,
        notes: booking.notes,
        createdBy: booking.createdBy,
        createdAt: booking.createdAt,
        updatedBy: booking.updatedBy,
        updatedAt: booking.updatedAt
      }
    });
    await writeJson(bookingsFile, remaining);
    await writeJson(deletedBookingsFile, logs);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: "Risorsa non trovata" });
}

function pruneSessions() {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (session.expiresAt < now) sessions.delete(key);
  }
}

await ensureDataFiles();
createBackup("avvio", "system").catch((error) => console.error("Backup iniziale non riuscito", error));
setInterval(pruneSessions, 1000 * 60 * 10).unref();
if (BACKUP_INTERVAL_MS > 0) {
  setInterval(() => {
    createBackup("automatico", "system").catch((error) => console.error("Backup automatico non riuscito", error));
  }, BACKUP_INTERVAL_MS).unref();
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/") || req.url.startsWith("/telnyx/voice")) {
      await handleApi(req, res);
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    const status = error.status || (error instanceof SyntaxError ? 400 : 500);
    sendJson(res, status, { error: status === 500 ? "Errore interno" : error.message });
  }
});

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/telnyx/conversation") {
    handleTelnyxConversation(req, socket);
    return;
  }
  socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
  socket.destroy();
});

server.listen(PORT, HOST, () => {
  console.log(`Muretto Prenotazioni avviato su http://${HOST}:${PORT}`);
});
