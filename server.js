import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = process.env.DATA_DIR || path.join(__dirname, "data");
const employeesFile = path.join(dataDir, "employees.json");
const bookingsFile = path.join(dataDir, "bookings.json");
const backupsDir = path.join(dataDir, "backups");
const sessions = new Map();

const PORT = Number(process.env.PORT || 4220);
const HOST = process.env.HOST || "127.0.0.1";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const MAX_BODY_BYTES = 32 * 1024;
const BACKUP_INTERVAL_MS = Number(process.env.MURETTO_BACKUP_INTERVAL_MS || 1000 * 60 * 60 * 24);
const BACKUP_RETENTION = Number(process.env.MURETTO_BACKUP_RETENTION || 30);

const DEFAULT_EMPLOYEE_NAME = process.env.MURETTO_ADMIN_NAME || "Admin";
const DEFAULT_EMPLOYEE_PIN = process.env.MURETTO_ADMIN_PIN || "123456";
const SYNC_ADMIN_PIN = process.env.MURETTO_SYNC_ADMIN_PIN === "true";

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

function sanitizeText(value, max = 180) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
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
      employees: await readJson(employeesFile, [])
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
    notes: sanitizeText(input.notes, 300)
  };

  const statuses = new Set(["confermata", "in attesa", "annullata", "completata"]);
  const rooms = new Set(["", "Ristorante", "Bar", "Giardino", "Interno"]);
  if (!booking.guestName) return "Inserisci il nome del cliente.";
  if (!booking.phone && !booking.email) return "Serve almeno un recapito.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booking.date)) return "Data non valida.";
  if (!/^\d{2}:\d{2}$/.test(booking.time)) return "Orario non valido.";
  if (!Number.isInteger(booking.people) || booking.people < 1 || booking.people > 40) return "Numero di persone non valido.";
  if (!rooms.has(booking.room)) return "Sala non valida.";
  if (!statuses.has(booking.status)) return "Stato non valido.";
  return booking;
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

  const session = requireSession(req, res);
  if (!session) return;

  if (url.pathname === "/api/agenda" && req.method === "GET") {
    const bookings = await readJson(bookingsFile, []);
    const date = normalizeDate(url.searchParams.get("date") || new Date().toISOString().slice(0, 10));
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
    sendJson(res, 200, { date, bookings: visible });
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
    const visible = bookings
      .filter((item) => !from || item.date >= from)
      .filter((item) => !to || item.date <= to)
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    sendJson(res, 200, { bookings: visible });
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
    bookings[index] = {
      ...bookings[index],
      ...result,
      updatedAt: new Date().toISOString(),
      updatedBy: session.employeeName
    };
    await writeJson(bookingsFile, bookings);
    sendJson(res, 200, { booking: bookings[index] });
    return;
  }

  if (bookingMatch && req.method === "DELETE") {
    if (!requireBookingEditor(session, res)) return;
    const bookings = await readJson(bookingsFile, []);
    const remaining = bookings.filter((item) => item.id !== bookingMatch[1]);
    if (remaining.length === bookings.length) {
      sendJson(res, 404, { error: "Prenotazione non trovata" });
      return;
    }
    await writeJson(bookingsFile, remaining);
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
