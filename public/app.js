const loginView = document.querySelector("#loginView");
const appView = document.querySelector("#appView");
const loginForm = document.querySelector("#loginForm");
const bookingForm = document.querySelector("#bookingForm");
const bookingList = document.querySelector("#bookingList");
const loginError = document.querySelector("#loginError");
const formMessage = document.querySelector("#formMessage");
const employeeName = document.querySelector("#employeeName");
const logoutButton = document.querySelector("#logoutButton");
const resetFormButton = document.querySelector("#resetFormButton");
const formTitle = document.querySelector("#formTitle");
const filterDate = document.querySelector("#filterDate");
const filterDateDisplay = document.querySelector("#filterDateDisplay");
const bookingDateDisplay = document.querySelector("#bookingDateDisplay");
const prevDayButton = document.querySelector("#prevDayButton");
const nextDayButton = document.querySelector("#nextDayButton");
const todayButton = document.querySelector("#todayButton");
const exportWeekButton = document.querySelector("#exportWeekButton");
const weeklyExportPanel = document.querySelector("#weeklyExportPanel");
const closeWeeklyExportButton = document.querySelector("#closeWeeklyExportButton");
const selectAllWeeklyButton = document.querySelector("#selectAllWeeklyButton");
const clearWeeklyButton = document.querySelector("#clearWeeklyButton");
const printWeeklyButton = document.querySelector("#printWeeklyButton");
const weeklyExportLabel = document.querySelector("#weeklyExportLabel");
const weeklyExportList = document.querySelector("#weeklyExportList");
const weeklySelectedCount = document.querySelector("#weeklySelectedCount");
const weeklyPrintArea = document.querySelector("#weeklyPrintArea");
const customerMessageDialog = document.querySelector("#customerMessageDialog");
const customerMessageForm = document.querySelector("#customerMessageForm");
const customerMessageTemplate = document.querySelector("#customerMessageTemplate");
const closeCustomerMessageButton = document.querySelector("#closeCustomerMessageButton");
const customerMessageTitle = document.querySelector("#customerMessageTitle");
const customerMessageSubtitle = document.querySelector("#customerMessageSubtitle");
const customerMessageStatus = document.querySelector("#customerMessageStatus");
const sendCustomerMessageButton = document.querySelector("#sendCustomerMessageButton");
const searchInput = document.querySelector("#searchInput");
const rangeLabel = document.querySelector("#rangeLabel");
const statCards = document.querySelectorAll("[data-room-filter]");
const roomStats = {
  ristorante: {
    card: document.querySelector("[data-room-filter='ristorante']"),
    people: document.querySelector("#restaurantPeople"),
    bookings: document.querySelector("#restaurantBookings"),
    day: document.querySelector("#restaurantDay"),
    evening: document.querySelector("#restaurantEvening"),
    warning: document.querySelector("#restaurantLimitWarning")
  },
  bar: {
    card: document.querySelector("[data-room-filter='bar']"),
    people: document.querySelector("#barPeople"),
    bookings: document.querySelector("#barBookings"),
    day: document.querySelector("#barDay"),
    evening: document.querySelector("#barEvening"),
    warning: document.querySelector("#barLimitWarning")
  },
  giardino: {
    card: document.querySelector("[data-room-filter='giardino']"),
    people: document.querySelector("#gardenPeople"),
    bookings: document.querySelector("#gardenBookings"),
    day: document.querySelector("#gardenDay"),
    evening: document.querySelector("#gardenEvening"),
    warning: document.querySelector("#gardenLimitWarning")
  }
};
const staffPanel = document.querySelector("#staffPanel");
const zoneSettingsPanel = document.querySelector("#zoneSettingsPanel");
const zoneSettingsForm = document.querySelector("#zoneSettingsForm");
const zoneSettingsDateLabel = document.querySelector("#zoneSettingsDateLabel");
const zoneSettingsMessage = document.querySelector("#zoneSettingsMessage");
const backupPanel = document.querySelector("#backupPanel");
const deleteLogPanel = document.querySelector("#deleteLogPanel");
const receivedBookingsPanel = document.querySelector("#receivedBookingsPanel");
const createBackupButton = document.querySelector("#createBackupButton");
const backupMessage = document.querySelector("#backupMessage");
const backupDownloadLink = document.querySelector("#backupDownloadLink");
const backupList = document.querySelector("#backupList");
const deleteLogList = document.querySelector("#deleteLogList");
const receivedBookingsList = document.querySelector("#receivedBookingsList");
const employeeForm = document.querySelector("#employeeForm");
const employeeList = document.querySelector("#employeeList");
const employeeMessage = document.querySelector("#employeeMessage");

let csrfToken = "";
let bookings = [];
let zoneStatsSettings = null;
let weeklyExportBookings = [];
let activeCustomerMessageBooking = null;
let currentEmployee = null;
let activeRoomFilter = "";

const today = new Date().toISOString().slice(0, 10);
filterDate.value = today;
bookingForm.elements.date.value = today;
bookingForm.elements.time.value = "20:00";
updateDateDisplay(filterDate, filterDateDisplay);
updateDateDisplay(bookingForm.elements.date, bookingDateDisplay);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Operazione non riuscita");
  return payload;
}

async function loadBrandConfig() {
  try {
    const payload = await api("/api/config");
    applyBrandConfig(payload.brand);
  } catch {
    applyBrandConfig(null);
  }
}

function applyBrandConfig(brand) {
  if (!brand) return;
  document.title = brand.appTitle || document.title;
  setText("[data-brand-name]", brand.name);
  setText("[data-brand-category]", brand.category);
  setText("[data-brand-monogram]", brand.monogram);
  setText("[data-brand-login-description]", brand.loginDescription);

  if (brand.colors?.accent) document.documentElement.style.setProperty("--accent", brand.colors.accent);
  if (brand.colors?.accentDark) document.documentElement.style.setProperty("--accent-dark", brand.colors.accentDark);
  if (brand.colors?.warm) document.documentElement.style.setProperty("--warm", brand.colors.warm);
}

function setText(selector, value) {
  if (!value) return;
  document.querySelectorAll(selector).forEach((element) => {
    element.textContent = value;
  });
}

function showLogin() {
  document.body.classList.remove("is-authenticated");
  loginView.hidden = false;
  loginView.style.display = "";
  appView.hidden = true;
  appView.style.display = "none";
  staffPanel.hidden = true;
  zoneSettingsPanel.hidden = true;
  receivedBookingsPanel.hidden = true;
  backupPanel.hidden = true;
  deleteLogPanel.hidden = true;
}

function showApp(employee) {
  currentEmployee = employee;
  document.body.classList.add("is-authenticated");
  employeeName.textContent = employee.name;
  staffPanel.hidden = employee.role !== "admin";
  zoneSettingsPanel.hidden = employee.role !== "admin";
  receivedBookingsPanel.hidden = employee.role !== "admin";
  backupPanel.hidden = employee.role !== "admin";
  deleteLogPanel.hidden = employee.role !== "admin";
  loginView.hidden = true;
  loginView.style.display = "none";
  appView.hidden = false;
  appView.style.display = "";
}

function bookingPayload() {
  const data = new FormData(bookingForm);
  const payload = Object.fromEntries(data.entries());
  payload.date = toApiDate(payload.date);
  return payload;
}

function resetForm() {
  const currentDate = selectedAgendaDate();
  bookingForm.reset();
  bookingForm.elements.id.value = "";
  bookingForm.elements.date.value = currentDate;
  bookingForm.elements.time.value = "20:00";
  bookingForm.elements.people.value = 2;
  bookingForm.elements.status.value = "confermata";
  formTitle.textContent = "Nuova prenotazione";
  formMessage.textContent = "";
  updateDateDisplay(bookingForm.elements.date, bookingDateDisplay);
}

function selectedAgendaDate() {
  return toApiDate(filterDate.value) || today;
}

function syncNewBookingDateWithAgenda() {
  if (bookingForm.elements.id.value) return;
  bookingForm.elements.date.value = selectedAgendaDate();
  updateDateDisplay(bookingForm.elements.date, bookingDateDisplay);
}

function statusClass(status) {
  return status.replace(/\s+/g, "-");
}

function matchesSearch(booking, term) {
  if (!term) return true;
  const haystack = `${booking.guestName} ${booking.phone} ${booking.email} ${booking.room} ${booking.tableNumber} ${booking.notes}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function matchesRoomFilter(booking) {
  if (!activeRoomFilter) return true;
  return roomStatKey(booking.room) === activeRoomFilter;
}

function renderRoomStats() {
  const stats = {
    ristorante: createRoomStat(),
    bar: createRoomStat(),
    giardino: createRoomStat()
  };

  for (const booking of bookings) {
    if (booking.status === "annullata") continue;
    const room = roomStatKey(booking.room);
    if (!stats[room]) continue;
    const people = Number(booking.people || 0);
    const meal = isEvening(booking.time) ? "evening" : "day";
    stats[room].people += people;
    stats[room].bookings += 1;
    stats[room][meal].people += people;
    stats[room][meal].bookings += 1;
  }

  for (const [room, values] of Object.entries(stats)) {
    roomStats[room].people.textContent = values.people;
    roomStats[room].bookings.textContent = `${values.bookings} ${values.bookings === 1 ? "prenotazione" : "prenotazioni"}`;
    roomStats[room].day.textContent = mealStatLine("Diurno", values.day);
    roomStats[room].evening.textContent = mealStatLine("Serale", values.evening);
    renderLimitWarning(room, values);
  }
}

function createRoomStat() {
  return {
    people: 0,
    bookings: 0,
    day: { people: 0, bookings: 0 },
    evening: { people: 0, bookings: 0 }
  };
}

function isEvening(time) {
  const [hours] = String(time || "").split(":").map(Number);
  return Number.isFinite(hours) && hours >= 18;
}

function mealStatLine(label, stat) {
  return `${label} ${stat.people} ${stat.people === 1 ? "coperto" : "coperti"} / ${stat.bookings} ${stat.bookings === 1 ? "pren." : "pren."}`;
}

function roomSettingName(room) {
  return {
    ristorante: "Ristorante Esterno",
    bar: "Bar",
    giardino: "Giardino"
  }[room] || "";
}

function roomStatKey(room) {
  const value = String(room || "").trim().toLowerCase();
  if (value === "ristorante" || value === "ristorante esterno") return "ristorante";
  return value;
}

function limitWarnings(room, values) {
  const settings = zoneStatsSettings?.zones?.[roomSettingName(room)];
  if (!settings) return [];
  return [
    limitWarningLine("Diurno", values.day, settings.day),
    limitWarningLine("Serale", values.evening, settings.evening)
  ].filter(Boolean);
}

function limitWarningLine(label, stat, rule = {}) {
  const people = Number(stat.people || 0);
  const limit = Number(rule.limit || 0);
  if (rule.blocked && people > 0) return `${label}: zona bloccata`;
  if (limit > 0 && people > limit) return `${label}: ${people}/${limit} coperti`;
  return "";
}

function renderLimitWarning(room, values) {
  const warningLines = limitWarnings(room, values);
  const elements = roomStats[room];
  elements.card.classList.toggle("is-over-limit", warningLines.length > 0);
  elements.warning.hidden = warningLines.length === 0;
  elements.warning.textContent = warningLines.length ? `Oltre limite: ${warningLines.join(" · ")}` : "";
}

function renderBookings() {
  const term = searchInput.value.trim();
  const filtered = bookings.filter((booking) => matchesSearch(booking, term) && matchesRoomFilter(booking));
  const filterApiDate = toApiDate(filterDate.value);
  const roomLabel = activeRoomFilter ? ` · ${roomFilterLabel(activeRoomFilter)}` : "";
  rangeLabel.textContent = filterApiDate ? `Data ${formatDate(filterApiDate)}${roomLabel}` : `Tutte le date${roomLabel}`;
  renderRoomStats();
  renderRoomFilterState();

  if (!filtered.length) {
    bookingList.innerHTML = `<p class="empty">Nessuna prenotazione trovata.</p>`;
    return;
  }

  bookingList.innerHTML = filtered.map((booking) => `
    <article class="booking-row ${booking.status === "arrivati" ? "is-arrived" : ""}">
      <div class="time">${escapeHtml(booking.time)}</div>
      <div class="booking-main">
        <h3>${escapeHtml(booking.guestName)} · ${Number(booking.people)} persone</h3>
        <p class="booking-details">${formatDate(booking.date)} · ${seatLine(booking)} · ${contactLine(booking)}</p>
        ${booking.notes ? `<p class="booking-notes">${escapeHtml(booking.notes)}</p>` : ""}
        <p><span class="status ${statusClass(booking.status)}">${escapeHtml(booking.status)}</span></p>
        <p class="booking-meta">${bookingMetaLine(booking)}</p>
      </div>
      <div class="actions">
        <button class="arrived" type="button" data-action="arrived" data-id="${booking.id}">${booking.status === "arrivati" ? "ANNULLA ARRIVO" : "ARRIVATI"}</button>
        ${booking.email ? `<button class="ghost" type="button" data-action="message" data-id="${booking.id}">Rispondi</button>` : ""}
        <button class="ghost" type="button" data-action="edit" data-id="${booking.id}">Modifica</button>
        <button class="delete" type="button" data-action="delete" data-id="${booking.id}">Elimina</button>
      </div>
    </article>
  `).join("");
}

function roomFilterLabel(room) {
  const labels = {
    ristorante: "Ristorante Esterno",
    bar: "Bar",
    giardino: "Giardino"
  };
  return labels[room] || room;
}

function roomDisplayName(room) {
  return roomStatKey(room) === "ristorante" ? "Ristorante Esterno" : String(room || "");
}

function renderRoomFilterState() {
  statCards.forEach((card) => {
    const isActive = card.dataset.roomFilter === activeRoomFilter;
    card.classList.toggle("is-active", isActive);
    card.setAttribute("aria-pressed", String(isActive));
  });
}

function renderEmployees(employees) {
  const active = employees.filter((employee) => employee.active);
  if (!active.length) {
    employeeList.innerHTML = `<p class="empty">Nessun dipendente attivo.</p>`;
    return;
  }

  employeeList.innerHTML = active.map((employee) => `
    <div class="employee-row">
      <div>
        <strong>${escapeHtml(employee.name)}</strong>
        <span>${escapeHtml(employee.role)}</span>
      </div>
      <span>${employee.name === currentEmployee?.name ? "sessione attiva" : ""}</span>
      <button class="ghost compact" type="button" data-employee-id="${employee.id}" ${employee.name === currentEmployee?.name ? "disabled" : ""}>Disattiva</button>
    </div>
  `).join("");
}

async function loadEmployees() {
  if (currentEmployee?.role !== "admin") return;
  const payload = await api("/api/employees");
  renderEmployees(payload.employees);
}

async function loadBackups() {
  if (currentEmployee?.role !== "admin") return;
  const payload = await api("/api/backups");
  renderBackups(payload.backups);
}

async function loadZoneSettings() {
  if (currentEmployee?.role !== "admin") return;
  const date = selectedAgendaDate();
  zoneSettingsDateLabel.textContent = `Giornata ${formatDate(date)}`;
  const payload = await api(`/api/zone-settings?date=${date}`);
  renderZoneSettings(payload.settings);
}

async function loadDeleteLogs() {
  if (currentEmployee?.role !== "admin") return;
  const payload = await api("/api/deleted-bookings");
  renderDeleteLogs(payload.logs);
}

async function loadReceivedBookings() {
  if (currentEmployee?.role !== "admin") return;
  const payload = await api("/api/received-bookings");
  renderReceivedBookings(payload.bookings);
}

function contactLine(booking) {
  const parts = [booking.phone, booking.email].filter(Boolean).map(escapeHtml);
  return parts.length ? parts.join(" · ") : "nessun recapito";
}

function bookingMetaLine(booking) {
  const created = booking.createdAt ? `${formatDateTime(booking.createdAt)}${booking.createdBy ? ` da ${booking.createdBy}` : ""}` : "";
  const updated = booking.updatedAt ? `${formatDateTime(booking.updatedAt)}${booking.updatedBy ? ` da ${booking.updatedBy}` : ""}` : "";
  const parts = [];
  if (created) parts.push(`Creata ${created}`);
  if (updated && (booking.updatedAt !== booking.createdAt || booking.updatedBy)) parts.push(`Modificata ${updated}`);
  if (booking.customerMessageSentAt) parts.push(`Risposta inviata ${formatDateTime(booking.customerMessageSentAt)}${booking.customerMessageSentBy ? ` da ${booking.customerMessageSentBy}` : ""}`);
  if (booking.customerActionNotificationSentAt) parts.push(`Notifica staff ${formatDateTime(booking.customerActionNotificationSentAt)}`);
  return parts.length ? parts.map(escapeHtml).join(" · ") : "Storico non disponibile";
}

function seatLine(booking) {
  const parts = [];
  if (booking.room) parts.push(`Sala ${roomDisplayName(booking.room)}`);
  if (booking.tableNumber) parts.push(`Tavolo ${booking.tableNumber}`);
  return parts.length ? parts.map(escapeHtml).join(" · ") : "sala/tavolo da assegnare";
}

function toApiDate(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function addDays(value, days) {
  const apiDate = toApiDate(value) || today;
  const date = new Date(`${apiDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekRangeFor(value) {
  const apiDate = toApiDate(value) || today;
  const date = new Date(`${apiDate}T12:00:00`);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  const from = date.toISOString().slice(0, 10);
  date.setDate(date.getDate() + 6);
  return { from, to: date.toISOString().slice(0, 10) };
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function formatDisplayDate(value) {
  if (!value) return "Seleziona data";
  return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(`${value}T12:00:00`))
    .replace(/\./g, "");
}

function updateDateDisplay(input, display) {
  display.textContent = formatDisplayDate(input.value);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatFileSize(bytes) {
  if (!Number.isFinite(Number(bytes))) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function backupDownloadUrl(name) {
  return `/api/backups/${encodeURIComponent(name)}`;
}

function renderBackups(backups) {
  if (!backups.length) {
    backupList.innerHTML = `<p class="empty compact-empty">Nessun backup disponibile.</p>`;
    return;
  }

  backupList.innerHTML = backups.map((backup) => `
    <div class="backup-row">
      <div>
        <strong>${formatDateTime(backup.createdAt)}</strong>
        <span>${formatFileSize(backup.size)}</span>
      </div>
      <a class="ghost-link compact-link" href="${backupDownloadUrl(backup.name)}" download="${escapeHtml(backup.name)}">Scarica</a>
    </div>
  `).join("");
}

function renderZoneSettings(settings) {
  zoneSettingsForm.querySelectorAll("[data-zone][data-period][data-field]").forEach((input) => {
    const value = settings.zones?.[input.dataset.zone]?.[input.dataset.period]?.[input.dataset.field];
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = value || "";
  });
}

function zoneSettingsPayload() {
  const zones = {};
  zoneSettingsForm.querySelectorAll("[data-zone][data-period][data-field]").forEach((input) => {
    zones[input.dataset.zone] ||= {};
    zones[input.dataset.zone][input.dataset.period] ||= {};
    zones[input.dataset.zone][input.dataset.period][input.dataset.field] = input.type === "checkbox" ? input.checked : Number(input.value || 0);
  });
  return { date: selectedAgendaDate(), zones };
}

function renderDeleteLogs(logs) {
  if (!logs.length) {
    deleteLogList.innerHTML = `<p class="empty compact-empty">Nessuna prenotazione cancellata.</p>`;
    return;
  }

  deleteLogList.innerHTML = logs.map((log) => {
    const booking = log.booking || {};
    const seat = seatLine(booking);
    const erased = Boolean(log.personalDataErasedAt);
    return `
      <div class="delete-log-row ${erased ? "is-erased" : ""}">
        <div>
          <strong>${escapeHtml(booking.guestName || "Prenotazione senza nome")}</strong>
          <span>${formatDate(booking.date)} · ${escapeHtml(booking.time || "")} · ${Number(booking.people || 0)} persone</span>
          <span>${seat}</span>
          ${erased ? `<span>Dati personali rimossi il ${formatDateTime(log.personalDataErasedAt)}</span>` : ""}
        </div>
        <div class="delete-log-meta">
          <strong>${escapeHtml(log.deletedBy || "sconosciuto")}</strong>
          <span>${formatDateTime(log.deletedAt)}</span>
          ${erased ? "" : `<button class="ghost compact privacy-erase-button" type="button" data-delete-log-id="${log.id}">Rimuovi dati personali</button>`}
        </div>
      </div>
    `;
  }).join("");
}

function renderReceivedBookings(receivedBookings) {
  if (!receivedBookings.length) {
    receivedBookingsList.innerHTML = `<p class="empty compact-empty">Nessuna prenotazione ricevuta dal modulo online.</p>`;
    return;
  }

  receivedBookingsList.innerHTML = receivedBookings.map((booking) => {
    const notification = booking.notificationEmailError
      ? `<span class="warning-text">${escapeHtml(booking.notificationEmailError)}</span>`
      : booking.notificationEmailSentAt
        ? `<span>Notifica email inviata il ${formatDateTime(booking.notificationEmailSentAt)}</span>`
        : "";
    return `
      <div class="received-booking-row">
        <div>
          <strong>${escapeHtml(booking.guestName || "Prenotazione senza nome")}</strong>
          <span>Ricevuta ${formatDateTime(booking.createdAt)}</span>
          <span>${formatDate(booking.date)} · ${escapeHtml(booking.time || "")} · ${Number(booking.people || 0)} persone</span>
          <span>${seatLine(booking)} · ${contactLine(booking)}</span>
          ${booking.notes ? `<span>${escapeHtml(booking.notes)}</span>` : ""}
          ${notification}
        </div>
        <span class="status ${statusClass(booking.status)}">${escapeHtml(booking.status)}</span>
      </div>
    `;
  }).join("");
}

async function openWeeklyExport() {
  const { from, to } = weekRangeFor(selectedAgendaDate());
  weeklyExportPanel.hidden = false;
  weeklyExportLabel.textContent = `Settimana ${formatDate(from)} - ${formatDate(to)}`;
  weeklyExportList.innerHTML = `<p class="empty compact-empty">Caricamento prenotazioni...</p>`;
  printWeeklyButton.disabled = true;

  const payload = await api(`/api/bookings?from=${from}&to=${to}`);
  weeklyExportBookings = payload.bookings
    .filter((booking) => booking.status !== "annullata")
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  renderWeeklyExport();
  weeklyExportPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderWeeklyExport() {
  if (!weeklyExportBookings.length) {
    weeklyExportList.innerHTML = `<p class="empty compact-empty">Nessuna prenotazione stampabile nella settimana selezionata.</p>`;
    updateWeeklySelectedCount();
    return;
  }

  weeklyExportList.innerHTML = weeklyExportBookings.map((booking) => `
    <label class="weekly-export-row">
      <input type="checkbox" value="${escapeHtml(booking.id)}" checked>
      <span>
        <strong>${escapeHtml(booking.guestName || "Prenotazione senza nome")}</strong>
        <small>${formatDate(booking.date)} · ${escapeHtml(booking.time || "")} · ${Number(booking.people || 0)} persone · ${seatLine(booking)}</small>
        <small>${contactLine(booking)}${booking.notes ? ` · ${escapeHtml(booking.notes)}` : ""}</small>
      </span>
      <span class="status ${statusClass(booking.status)}">${escapeHtml(booking.status)}</span>
    </label>
  `).join("");
  updateWeeklySelectedCount();
}

function selectedWeeklyBookings() {
  const selectedIds = new Set(Array.from(weeklyExportList.querySelectorAll("input[type='checkbox']:checked")).map((input) => input.value));
  return weeklyExportBookings.filter((booking) => selectedIds.has(booking.id));
}

function updateWeeklySelectedCount() {
  const selected = selectedWeeklyBookings();
  weeklySelectedCount.textContent = weeklyExportBookings.length ? `${selected.length} selezionate su ${weeklyExportBookings.length}` : "";
  printWeeklyButton.disabled = selected.length === 0;
}

function renderWeeklyPrintArea(selected) {
  const { from, to } = weekRangeFor(selectedAgendaDate());
  weeklyPrintArea.innerHTML = `
    <article class="weekly-print-sheet">
      <header>
        <p>Il Muretto</p>
        <h1>Prenotazioni settimana</h1>
        <span>${formatDate(from)} - ${formatDate(to)}</span>
      </header>
      <section>
        ${selected.map((booking) => `
          <article class="weekly-print-booking">
            <div>
              <h2>${escapeHtml(booking.guestName || "Prenotazione senza nome")}</h2>
              <p>${formatDate(booking.date)} · ${escapeHtml(booking.time || "")} · ${Number(booking.people || 0)} persone</p>
              <p>${seatLine(booking)}</p>
              <p>${contactLine(booking)}</p>
            </div>
            <div>
              <strong>${escapeHtml(booking.status)}</strong>
              ${booking.notes ? `<p>${escapeHtml(booking.notes)}</p>` : ""}
            </div>
          </article>
        `).join("")}
      </section>
    </article>
  `;
}

function defaultCustomerMessage(booking) {
  return [
    `Ciao ${booking.guestName},`,
    "",
    "ti scriviamo in merito alla tua richiesta di prenotazione.",
    "",
    "",
    "A presto!",
    `Lo Staff del Muretto`
  ].join("\n");
}

function alternativeRoomMessage(booking) {
  const proposedSeat = booking.room || booking.tableNumber ? seatLine(booking).replace(/&amp;/g, "&") : "una soluzione alternativa da concordare insieme";
  return [
    `Ciao ${booking.guestName},`,
    "",
    "ti scriviamo in merito alla tua richiesta di prenotazione.",
    "",
    "Purtroppo la sala richiesta non è disponibile per la data e l'orario indicati.",
    `Possiamo però proporti questa alternativa: ${proposedSeat}.`,
    "",
    "Se per te va bene, rispondi pure a questa email e procederemo con la conferma.",
    "",
    "A presto!",
    "Lo Staff del Muretto"
  ].join("\n");
}

function rainGuaranteedMessage(booking) {
  return [
    `Ciao ${booking.guestName},`,
    "",
    "ti scriviamo in merito alla tua richiesta di prenotazione.",
    "",
    "Le previsioni meteo al momento non sono delle migliori.",
    "Il tuo tavolo all'esterno è confermato e, per sicurezza, allestiremo anche un tavolo interno nel caso in cui inizi a piovere.",
    "",
    "Puoi confermare o annullare la prenotazione anche fino a un'ora prima usando i pulsanti presenti in questa email.",
    "",
    "A presto!",
    "Lo Staff del Muretto"
  ].join("\n");
}

function rainNotGuaranteedMessage(booking) {
  return [
    `Ciao ${booking.guestName},`,
    "",
    "ti scriviamo in merito alla tua richiesta di prenotazione.",
    "",
    "Le previsioni meteo al momento non sono delle migliori.",
    "Il tuo tavolo all'esterno è confermato, ma non possiamo garantire lo spostamento in sala interna in caso di pioggia.",
    "",
    "Puoi confermare o annullare la prenotazione anche fino a un'ora prima usando i pulsanti presenti in questa email.",
    "",
    "A presto!",
    "Lo Staff del Muretto"
  ].join("\n");
}

function applyCustomerMessageTemplate(template) {
  if (!activeCustomerMessageBooking) return;
  if (template === "alternative") {
    customerMessageForm.elements.subject.value = "Alternativa per la tua richiesta - Muretto";
    customerMessageForm.elements.message.value = alternativeRoomMessage(activeCustomerMessageBooking);
    return;
  }
  if (template === "rain-guaranteed") {
    customerMessageForm.elements.subject.value = "Aggiornamento meteo per la tua prenotazione - Muretto";
    customerMessageForm.elements.message.value = rainGuaranteedMessage(activeCustomerMessageBooking);
    return;
  }
  if (template === "rain-not-guaranteed") {
    customerMessageForm.elements.subject.value = "Aggiornamento meteo per la tua prenotazione - Muretto";
    customerMessageForm.elements.message.value = rainNotGuaranteedMessage(activeCustomerMessageBooking);
    return;
  }
  customerMessageForm.elements.subject.value = "Risposta alla tua richiesta - Muretto";
  customerMessageForm.elements.message.value = defaultCustomerMessage(activeCustomerMessageBooking);
}

function openCustomerMessageDialog(booking) {
  activeCustomerMessageBooking = booking;
  customerMessageForm.reset();
  customerMessageForm.elements.bookingId.value = booking.id;
  customerMessageTemplate.value = "custom";
  applyCustomerMessageTemplate("custom");
  customerMessageTitle.textContent = `Messaggio per ${booking.guestName}`;
  customerMessageSubtitle.textContent = `${booking.email} · ${formatDate(booking.date)} alle ${booking.time}`;
  customerMessageStatus.textContent = "";
  sendCustomerMessageButton.disabled = false;
  if (typeof customerMessageDialog.showModal === "function") customerMessageDialog.showModal();
  else customerMessageDialog.setAttribute("open", "");
}

function closeCustomerMessageDialog() {
  activeCustomerMessageBooking = null;
  if (typeof customerMessageDialog.close === "function") customerMessageDialog.close();
  else customerMessageDialog.removeAttribute("open");
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

async function loadBookings() {
  const filterApiDate = toApiDate(filterDate.value);
  if (filterDate.value && !filterApiDate) {
    formMessage.textContent = "Usa il formato data GG/MM/AAAA.";
    return;
  }
  const query = filterApiDate ? `?from=${filterApiDate}&to=${filterApiDate}` : "";
  const payload = await api(`/api/bookings${query}`);
  bookings = payload.bookings;
  zoneStatsSettings = payload.zoneSettings || null;
  renderBookings();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const data = Object.fromEntries(new FormData(loginForm).entries());
  try {
    const payload = await api("/api/login", { method: "POST", body: JSON.stringify(data) });
    csrfToken = payload.csrfToken;
    if (payload.employee.role === "agenda") {
      window.location.href = "/agenda.html";
      return;
    }
    showApp(payload.employee);
    await loadBookings();
    await loadReceivedBookings();
    await loadEmployees();
    await loadZoneSettings();
    await loadBackups();
    await loadDeleteLogs();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formMessage.textContent = "";
  const payload = bookingPayload();
  const id = payload.id;
  delete payload.id;
  try {
    if (id) {
      await api(`/api/bookings/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      formMessage.textContent = "Prenotazione aggiornata.";
    } else {
      await api("/api/bookings", { method: "POST", body: JSON.stringify(payload) });
      formMessage.textContent = "Prenotazione salvata.";
    }
    resetForm();
    await loadBookings();
  } catch (error) {
    formMessage.textContent = error.message;
  }
});

bookingList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const booking = bookings.find((item) => item.id === button.dataset.id);
  if (!booking) return;

  if (button.dataset.action === "edit") {
    formTitle.textContent = "Modifica prenotazione";
    for (const [key, value] of Object.entries(booking)) {
      if (bookingForm.elements[key]) bookingForm.elements[key].value = value;
    }
    if (roomStatKey(booking.room) === "ristorante") bookingForm.elements.room.value = "Ristorante Esterno";
    bookingForm.elements.date.value = booking.date;
    updateDateDisplay(bookingForm.elements.date, bookingDateDisplay);
    formMessage.textContent = "";
    bookingForm.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  if (button.dataset.action === "arrived") {
    await api(`/api/bookings/${booking.id}/arrived`, { method: "PATCH", body: JSON.stringify({}) });
    await loadBookings();
    return;
  }

  if (button.dataset.action === "message") {
    if (!booking.email) return;
    openCustomerMessageDialog(booking);
    return;
  }

  if (button.dataset.action === "delete") {
    const ok = confirm(`Eliminare la prenotazione di ${booking.guestName}?`);
    if (!ok) return;
    await api(`/api/bookings/${booking.id}`, { method: "DELETE" });
    await loadBookings();
    await loadDeleteLogs();
  }
});

closeCustomerMessageButton.addEventListener("click", closeCustomerMessageDialog);

customerMessageTemplate.addEventListener("change", () => {
  applyCustomerMessageTemplate(customerMessageTemplate.value);
});

customerMessageDialog.addEventListener("click", (event) => {
  if (event.target === customerMessageDialog) closeCustomerMessageDialog();
});

customerMessageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  customerMessageStatus.textContent = "Invio email in corso...";
  sendCustomerMessageButton.disabled = true;
  const payload = Object.fromEntries(new FormData(customerMessageForm).entries());
  try {
    await api(`/api/bookings/${payload.bookingId}/message`, {
      method: "POST",
      body: JSON.stringify({
        subject: payload.subject,
        message: payload.message
      })
    });
    customerMessageStatus.textContent = "Email inviata.";
    await loadBookings();
    setTimeout(closeCustomerMessageDialog, 700);
  } catch (error) {
    customerMessageStatus.textContent = error.message;
    sendCustomerMessageButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  csrfToken = "";
  bookings = [];
  currentEmployee = null;
  loginForm.reset();
  showLogin();
});

resetFormButton.addEventListener("click", resetForm);
filterDate.addEventListener("change", async () => {
  updateDateDisplay(filterDate, filterDateDisplay);
  syncNewBookingDateWithAgenda();
  await loadBookings();
  await loadZoneSettings();
});
bookingForm.elements.date.addEventListener("change", () => {
  updateDateDisplay(bookingForm.elements.date, bookingDateDisplay);
});
prevDayButton.addEventListener("click", async () => {
  filterDate.value = addDays(filterDate.value, -1);
  updateDateDisplay(filterDate, filterDateDisplay);
  syncNewBookingDateWithAgenda();
  await loadBookings();
  await loadZoneSettings();
});
nextDayButton.addEventListener("click", async () => {
  filterDate.value = addDays(filterDate.value, 1);
  updateDateDisplay(filterDate, filterDateDisplay);
  syncNewBookingDateWithAgenda();
  await loadBookings();
  await loadZoneSettings();
});
todayButton.addEventListener("click", async () => {
  filterDate.value = today;
  updateDateDisplay(filterDate, filterDateDisplay);
  syncNewBookingDateWithAgenda();
  await loadBookings();
  await loadZoneSettings();
});

exportWeekButton.addEventListener("click", async () => {
  try {
    await openWeeklyExport();
  } catch (error) {
    weeklyExportPanel.hidden = false;
    weeklyExportList.innerHTML = `<p class="empty compact-empty">${escapeHtml(error.message)}</p>`;
  }
});

closeWeeklyExportButton.addEventListener("click", () => {
  weeklyExportPanel.hidden = true;
});

selectAllWeeklyButton.addEventListener("click", () => {
  weeklyExportList.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = true;
  });
  updateWeeklySelectedCount();
});

clearWeeklyButton.addEventListener("click", () => {
  weeklyExportList.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = false;
  });
  updateWeeklySelectedCount();
});

weeklyExportList.addEventListener("change", (event) => {
  if (event.target.matches("input[type='checkbox']")) updateWeeklySelectedCount();
});

printWeeklyButton.addEventListener("click", () => {
  const selected = selectedWeeklyBookings();
  if (!selected.length) return;
  renderWeeklyPrintArea(selected);
  document.body.classList.add("is-printing-week");
  window.print();
  setTimeout(() => document.body.classList.remove("is-printing-week"), 500);
});

searchInput.addEventListener("input", renderBookings);

statCards.forEach((card) => {
  const toggleRoomFilter = () => {
    const room = card.dataset.roomFilter;
    activeRoomFilter = activeRoomFilter === room ? "" : room;
    renderBookings();
  };
  card.addEventListener("click", toggleRoomFilter);
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleRoomFilter();
  });
});

employeeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  employeeMessage.textContent = "";
  const payload = Object.fromEntries(new FormData(employeeForm).entries());
  try {
    await api("/api/employees", { method: "POST", body: JSON.stringify(payload) });
    employeeForm.reset();
    employeeMessage.textContent = "Dipendente aggiunto.";
    await loadEmployees();
  } catch (error) {
    employeeMessage.textContent = error.message;
  }
});

employeeList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-employee-id]");
  if (!button || button.disabled) return;
  const ok = confirm("Disattivare questo accesso dipendente?");
  if (!ok) return;
  await api(`/api/employees/${button.dataset.employeeId}`, { method: "DELETE" });
  await loadEmployees();
});

createBackupButton.addEventListener("click", async () => {
  backupMessage.textContent = "Creazione backup in corso...";
  backupDownloadLink.hidden = true;
  try {
    const payload = await api("/api/backups", { method: "POST" });
    backupMessage.textContent = `Backup creato il ${formatDateTime(payload.backup.createdAt)}.`;
    backupDownloadLink.href = payload.downloadUrl;
    backupDownloadLink.download = payload.backup.name;
    backupDownloadLink.hidden = false;
    await loadBackups();
  } catch (error) {
    backupMessage.textContent = error.message;
  }
});

deleteLogList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-delete-log-id]");
  if (!button) return;
  const ok = confirm("Rimuovere nome, recapiti e note personali da questo log?");
  if (!ok) return;
  button.disabled = true;
  try {
    await api(`/api/deleted-bookings/${button.dataset.deleteLogId}/personal-data`, { method: "DELETE" });
    await loadDeleteLogs();
  } catch (error) {
    button.disabled = false;
    button.textContent = error.message;
  }
});

zoneSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  zoneSettingsMessage.textContent = "Salvataggio limiti...";
  try {
    await api("/api/zone-settings", { method: "PUT", body: JSON.stringify(zoneSettingsPayload()) });
    zoneSettingsMessage.textContent = "Limiti salvati.";
    await loadBookings();
  } catch (error) {
    zoneSettingsMessage.textContent = error.message;
  }
});

await loadBrandConfig();

const me = await api("/api/me").catch(() => ({ employee: null }));
if (me.employee) {
  csrfToken = me.csrfToken;
  if (me.employee.role === "agenda") {
    window.location.href = "/agenda.html";
  } else {
  showApp(me.employee);
  await loadBookings();
  await loadReceivedBookings();
  await loadEmployees();
  await loadZoneSettings();
  await loadBackups();
  await loadDeleteLogs();
  }
} else {
  showLogin();
}
