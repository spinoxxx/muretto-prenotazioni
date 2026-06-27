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
const PRIVACY_VERSION = "2026-06-26";
const PRIVACY_CONTROLLER = "Bar Flora srl, Piazza Vecchia 13, 24129 Bergamo";
const VENUE_ADDRESS = "Viale delle Mura 1, 24129 Bergamo";
const VENUE_MAP_URL = "https://www.google.com/maps/search/?api=1&query=Viale%20delle%20Mura%201%2C%2024129%20Bergamo";

const DEFAULT_EMPLOYEE_NAME = process.env.MURETTO_ADMIN_NAME || "Admin";
const DEFAULT_EMPLOYEE_PIN = process.env.MURETTO_ADMIN_PIN || "123456";
const SYNC_ADMIN_PIN = process.env.MURETTO_SYNC_ADMIN_PIN === "true";
const privacyControllerEnv = process.env.MURETTO_PRIVACY_CONTROLLER;
const EMAIL_FROM = sanitizePublicText(process.env.MURETTO_EMAIL_FROM, "", 160);
const RESEND_API_KEY = process.env.MURETTO_RESEND_API_KEY || "";
const SMTP_HOST = sanitizePublicText(process.env.MURETTO_SMTP_HOST, "", 120);
const SMTP_PORT = Number(process.env.MURETTO_SMTP_PORT || 465);
const SMTP_USER = sanitizePublicText(process.env.MURETTO_SMTP_USER, "", 160);
const SMTP_PASS = String(process.env.MURETTO_SMTP_PASS || "").replace(/\s+/g, "");
const BRAND_CONFIG = {
  name: sanitizePublicText(process.env.MURETTO_BRAND_NAME, "Il Muretto", 80),
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
      zoneSettings: await readJson(zoneSettingsFile, {})
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
    notes: sanitizeText(input.notes, 300)
  };

  const statuses = new Set(["confermata", "in attesa", "da verificare", "arrivati", "annullata", "completata"]);
  const rooms = new Set(["", RESTAURANT_ROOM, LEGACY_RESTAURANT_ROOM, "Bar", "Giardino", "Interno"]);
  if (booking.room === LEGACY_RESTAURANT_ROOM) booking.room = RESTAURANT_ROOM;
  if (!booking.guestName) return "Inserisci il nome del cliente.";
  if (!booking.phone && !booking.email) return "Serve almeno un recapito.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booking.date)) return "Data non valida.";
  if (!/^\d{2}:\d{2}$/.test(booking.time)) return "Orario non valido.";
  if (!Number.isInteger(booking.people) || booking.people < 1 || booking.people > 40) return "Numero di persone non valido.";
  if (!rooms.has(booking.room)) return "Sala non valida.";
  if (!statuses.has(booking.status)) return "Stato non valido.";
  return booking;
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
  const allowedConsumptions = new Set(["cena", "aperitivo"]);
  if (!privacyAccepted) return language === "en" ? "You must read and accept the privacy notice." : "Devi leggere e accettare l'informativa privacy.";
  if (!allowedConsumptions.has(consumption)) return language === "en" ? "Choose dinner or aperitif." : "Scegli cena o aperitivo.";
  if (gardenRequested && consumption !== "cena") return language === "en" ? "The garden can only be requested for dinner." : "Il giardino si puo richiedere solo per cena.";

  const room = consumption === "aperitivo" ? "Bar" : gardenRequested ? "Giardino" : RESTAURANT_ROOM;
  const notes = [
    "Richiesta dal modulo online.",
    `Consumazione prevista: ${consumption}.`,
    gardenRequested ? "Richiesta giardino: da confermare." : "",
    sanitizeText(input.notes, 220)
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
    notes
  });
  return typeof booking === "string" ? publicValidationError(booking, language) : booking;
}

function mealPeriod(time) {
  const [hours] = String(time || "").split(":").map(Number);
  return Number.isFinite(hours) && hours >= 18 ? "evening" : "day";
}

function emptyZonePeriod() {
  return { limit: 0, blocked: false };
}

function emptyZoneRoom() {
  return {
    day: emptyZonePeriod(),
    evening: emptyZonePeriod()
  };
}

function defaultZoneSettings(date) {
  return {
    date,
    zones: Object.fromEntries(ZONE_ROOMS.map((room) => [room, emptyZoneRoom()]))
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
      settings.zones[room][period] = {
        limit: normalizeLimit(source.limit),
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

function bookingConfirmationText(booking) {
  const language = normalizeLanguage(booking.language);
  const seat = emailSeatLine(booking, language);
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
      "",
      "Important note:",
      "- Due to the imbalance between indoor and outdoor seating, in case of rain we cannot guarantee that the booking can be moved to a sheltered area.",
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
    "",
    "Nota importante:",
    "- Visto lo squilibrio tra le sedute interne ed esterne, in caso di pioggia non garantiamo di poter spostare la prenotazione in area protetta.",
    "- Il tavolo verrà tenuto per un massimo di 30 minuti. Eventuali ritardi possono essere comunicati al 3288123575.",
    "- Se hai necessità di MODIFICARE o CANCELLARE la prenotazione puoi farlo rispondendo a questa email.",
    "",
    "A presto!",
    `Lo Staff del ${BRAND_CONFIG.name}`
  ].filter(Boolean).join("\n");
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

function smtpMessage(booking) {
  const fromAddress = extractEmailAddress(EMAIL_FROM);
  const subject = bookingEmailSubject(booking);
  const body = bookingConfirmationText(booking);
  return [
    `From: ${EMAIL_FROM}`,
    `To: ${booking.email}`,
    `Subject: ${encodeEmailHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body
  ].join("\r\n").replace(/^\./gm, "..") + "\r\n";
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
    const zoneError = await publicZoneError(result, bookings);
    if (zoneError) {
      sendJson(res, 409, { error: zoneError });
      return;
    }
    const now = new Date().toISOString();
    const booking = {
      id: crypto.randomUUID(),
      ...result,
      createdBy: "modulo online",
      createdAt: now,
      updatedAt: now,
      updatedBy: "modulo online",
      privacyAcceptedAt: now,
      privacyVersion: PRIVACY_VERSION
    };
    bookings.push(booking);
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
    bookings[index] = await markConfirmationEmailIfNeeded(previousBooking, {
      ...previousBooking,
      ...result,
      updatedAt: new Date().toISOString(),
      updatedBy: session.employeeName
    }, session.employeeName);
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
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    const status = error.status || (error instanceof SyntaxError ? 400 : 500);
    sendJson(res, status, { error: status === 500 ? "Errore interno" : error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Muretto Prenotazioni avviato su http://${HOST}:${PORT}`);
});
