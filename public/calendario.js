const loginView = document.querySelector("#calendarLoginView");
const calendarView = document.querySelector("#calendarView");
const loginForm = document.querySelector("#calendarLoginForm");
const loginError = document.querySelector("#calendarLoginError");
const employeeName = document.querySelector("#calendarEmployeeName");
const logoutButton = document.querySelector("#calendarLogoutButton");
const openEventManagerButton = document.querySelector("#openCalendarEventManager");
const dateInput = document.querySelector("#calendarDate");
const prevButton = document.querySelector("#calendarPrevButton");
const nextButton = document.querySelector("#calendarNextButton");
const todayButton = document.querySelector("#calendarTodayButton");
const viewMode = document.querySelector("#calendarViewMode");
const roomFilter = document.querySelector("#calendarRoomFilter");
const statusFilter = document.querySelector("#calendarStatusFilter");
const typeFilter = document.querySelector("#calendarTypeFilter");
const rangeLabel = document.querySelector("#calendarRangeLabel");
const calendarGrid = document.querySelector("#calendarGrid");
const calendarDetail = document.querySelector("#calendarDetail");
const eventManager = document.querySelector("#calendarEventManager");
const eventForm = document.querySelector("#calendarEventForm");
const eventError = document.querySelector("#calendarEventError");
const eventList = document.querySelector("#calendarEventList");
const publicEventFields = document.querySelector("[data-public-event-fields]");
let eventDefinitions = [];

let csrfToken = "";
let currentEmployee = null;
let calendarItems = [];
const today = new Date().toISOString().slice(0, 10);
dateInput.value = today;
eventForm.elements.date.value = today;

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
    const brand = payload.brand;
    if (!brand) return;
    document.title = brand.name ? `Calendario ${brand.name}` : document.title;
    setText("[data-brand-category]", brand.category);
    setText("[data-brand-monogram]", brand.monogram);
    if (brand.colors?.accent) document.documentElement.style.setProperty("--accent", brand.colors.accent);
    if (brand.colors?.accentDark) document.documentElement.style.setProperty("--accent-dark", brand.colors.accentDark);
    if (brand.colors?.warm) document.documentElement.style.setProperty("--warm", brand.colors.warm);
  } catch {
    // Il calendario resta utilizzabile anche se il white label non carica.
  }
}

function setText(selector, value) {
  if (!value) return;
  document.querySelectorAll(selector).forEach((element) => {
    element.textContent = value;
  });
}

function canViewCalendar(employee) {
  return ["admin", "staff", "calendario"].includes(employee?.role) || employee?.calendarAccess === true;
}

function canManageCalendarEvents(employee) {
  return employee?.role === "admin" || employee?.calendarEventAccess === true;
}

function showLogin() {
  loginView.hidden = false;
  calendarView.hidden = true;
  currentEmployee = null;
}

function showCalendar(employee) {
  currentEmployee = employee;
  employeeName.textContent = employee.name;
  loginView.hidden = true;
  calendarView.hidden = false;
  const canManageEvents = canManageCalendarEvents(employee);
  eventManager.hidden = !canManageEvents;
  openEventManagerButton.hidden = !canManageEvents;
  if (canManageEvents) {
    loadEventDefinitions();
    if (new URLSearchParams(window.location.search).get("gestione") === "eventi") openEventManager();
  }
}

function openEventManager() {
  eventManager.open = true;
  eventManager.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => eventForm.elements.title.focus(), 350);
}

function addDays(value, days) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function startOfWeek(value) {
  const date = new Date(`${value}T12:00:00`);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function startOfMonth(value) {
  return `${value.slice(0, 7)}-01`;
}

function endOfMonth(value) {
  const date = new Date(`${startOfMonth(value)}T12:00:00`);
  date.setMonth(date.getMonth() + 1);
  date.setDate(0);
  return date.toISOString().slice(0, 10);
}

function monthGridRange(value) {
  const from = startOfWeek(startOfMonth(value));
  const lastDay = endOfMonth(value);
  const lastWeekStart = startOfWeek(lastDay);
  return { from, to: addDays(lastWeekStart, 6) };
}

function rangeForView() {
  if (viewMode.value === "day") return { from: dateInput.value, to: dateInput.value };
  if (viewMode.value === "month") return monthGridRange(dateInput.value);
  const from = startOfWeek(dateInput.value);
  return { from, to: addDays(from, 6) };
}

function formatDate(value, opts = {}) {
  return new Intl.DateTimeFormat("it-IT", opts.dayOnly
    ? { weekday: "short", day: "2-digit", month: "2-digit" }
    : { weekday: "long", day: "2-digit", month: "long", year: "numeric" }
  ).format(new Date(`${value}T12:00:00`));
}

function statusValue(item) {
  if (item.requestType === "event") return "evento";
  return item.requestType === "special" ? item.specialStatus || "nuova" : item.status;
}

function visibleItems() {
  return calendarItems.filter((item) => {
    if (roomFilter.value && item.room !== roomFilter.value) return false;
    if (typeFilter.value && item.requestType !== typeFilter.value) return false;
    if (statusFilter.value && statusValue(item) !== statusFilter.value) return false;
    return true;
  });
}

function itemClass(item) {
  const classes = ["calendar-event"];
  classes.push(item.requestType === "event" ? "is-venue-event" : item.requestType === "special" ? "is-special" : "is-standard");
  if (item.status === "annullata" || item.specialStatus === "annullata") classes.push("is-cancelled");
  if (item.status === "in attesa") classes.push("is-waiting");
  if (item.room === "Bar") classes.push("is-bar-room");
  return classes.join(" ");
}

function renderCalendar() {
  const { from, to } = rangeForView();
  const isMonth = viewMode.value === "month";
  rangeLabel.textContent = viewMode.value === "day"
    ? formatDate(from)
    : isMonth
      ? new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(new Date(`${dateInput.value}T12:00:00`))
      : `${formatDate(from)} - ${formatDate(to)}`;
  const days = viewMode.value === "day"
    ? [dateInput.value]
    : isMonth
      ? Array.from({ length: Math.round((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / 86400000) + 1 }, (_, index) => addDays(from, index))
      : Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(dateInput.value), index));
  const items = visibleItems();

  calendarGrid.classList.toggle("is-day-view", viewMode.value === "day");
  calendarGrid.classList.toggle("is-month-view", isMonth);
  calendarGrid.innerHTML = days.map((day) => {
    const dayItems = items.filter((item) => item.date === day);
    const outsideMonth = isMonth && day.slice(0, 7) !== dateInput.value.slice(0, 7);
    const isToday = day === today;
    return `
      <section class="calendar-day${outsideMonth ? " is-outside-month" : ""}${isToday ? " is-today" : ""}">
        <header>
          <strong>${formatDate(day, { dayOnly: true })}</strong>
          <span>${dayItems.length} blocchi</span>
        </header>
        <div class="calendar-day-body">
          ${dayItems.length ? dayItems.map(renderCalendarEvent).join("") : `<p class="empty compact-empty">Nessun blocco.</p>`}
        </div>
      </section>
    `;
  }).join("");
}

function renderCalendarEvent(item) {
  if (item.requestType === "event") {
    return `
      <button class="${itemClass(item)}" type="button" data-calendar-id="${item.id}">
        <span>${escapeHtml(item.time || "Evento")}</span>
        <strong>${escapeHtml(item.title || item.guestName || "Evento Muretto")}</strong>
        <small>${escapeHtml(item.room || "Tutto il locale")}</small>
        ${item.recurrence === "weekly" ? `<small>Ogni settimana</small>` : ""}
      </button>
    `;
  }
  const label = item.requestType === "special" ? `${item.specialType || "speciale"} · ${statusValue(item)}` : item.status;
  return `
    <button class="${itemClass(item)}" type="button" data-calendar-id="${item.id}">
      <span>${escapeHtml(item.time || "")}</span>
      <strong>${escapeHtml(item.guestName || "Senza nome")}</strong>
      <small>${Number(item.people || 0)} persone · ${escapeHtml(item.room || "Sala da definire")}</small>
      <small>${escapeHtml(label)}</small>
    </button>
  `;
}

function renderDetail(item) {
  if (item.requestType === "event") {
    calendarDetail.innerHTML = `
      <div class="calendar-detail-card">
        <p class="eyebrow">Evento Muretto</p>
        <h2>${escapeHtml(item.title || item.guestName)}</h2>
        <p>${formatDate(item.date)}${item.time ? ` · ${escapeHtml(item.time)}` : " · Orario non indicato"}</p>
        <p>${escapeHtml(item.room || "Tutto il locale")}</p>
        ${item.recurrence === "weekly" ? `<p><strong>Ricorrenza:</strong> ogni settimana</p>` : ""}
        ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
        ${canManageCalendarEvents(currentEmployee) ? `<button class="danger ghost" type="button" data-delete-calendar-event="${item.sourceEventId}">Elimina evento${item.recurrence === "weekly" ? " ricorrente" : ""}</button>` : ""}
      </div>
    `;
    return;
  }
  calendarDetail.innerHTML = `
    <div class="calendar-detail-card">
      <p class="eyebrow">${item.requestType === "special" ? "Richiesta speciale" : "Prenotazione"}</p>
      <h2>${escapeHtml(item.guestName || "Senza nome")}</h2>
      <p>${formatDate(item.date)} · ${escapeHtml(item.time || "")} · ${Number(item.people || 0)} persone</p>
      <p>${escapeHtml(item.room || "Sala da definire")}${item.tableNumber ? ` · Tavolo ${escapeHtml(item.tableNumber)}` : ""}</p>
      <p><span class="status ${statusClass(statusValue(item))}">${escapeHtml(statusValue(item))}</span></p>
      ${item.specialType ? `<p><strong>Tipo:</strong> ${escapeHtml(item.specialType)} · ${escapeHtml(item.specialTimeWindow || "")}</p>` : ""}
      ${item.assignedTo ? `<p><strong>Assegnata a:</strong> ${escapeHtml(item.assignedTo)}</p>` : ""}
      ${item.phone || item.email ? `<p>${escapeHtml([item.phone, item.email].filter(Boolean).join(" · "))}</p>` : ""}
      ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
      ${item.internalNotes ? `<p><strong>Note interne:</strong> ${escapeHtml(item.internalNotes)}</p>` : ""}
      ${currentEmployee?.role === "admin" || currentEmployee?.role === "staff" ? `<a class="ghost-link" href="/">Apri pannello</a>` : ""}
    </div>
  `;
}

function formatEventDefinition(event) {
  const date = formatDate(event.date);
  const time = event.time ? ` · ${event.time}` : "";
  const recurrence = event.recurrence === "weekly" ? " · ogni settimana" : "";
  return `${date}${time}${recurrence}`;
}

function syncPublicEventFields() {
  publicEventFields.hidden = !eventForm.elements.publicEnabled.checked;
}

function resetEventForm() {
  eventForm.reset();
  eventForm.elements.id.value = "";
  eventForm.elements.date.value = dateInput.value;
  eventForm.elements.publishDaysBefore.value = "14";
  eventForm.elements.menuLabel.value = "Apri il menu";
  eventForm.elements.bookingEnabled.checked = true;
  syncPublicEventFields();
}

function editEventDefinition(item) {
  resetEventForm();
  for (const name of ["id", "title", "date", "time", "room", "recurrence", "notes", "publicDescription", "publicDescriptionEn", "priceLabel", "priceLabelEn", "publishDaysBefore", "menuLabel"]) {
    if (eventForm.elements[name]) eventForm.elements[name].value = item[name] ?? "";
  }
  eventForm.elements.publicEnabled.checked = item.publicEnabled === true;
  eventForm.elements.bookingEnabled.checked = item.bookingEnabled === true;
  syncPublicEventFields();
  openEventManager();
}

function fileAsDataUrl(file) {
  if (!file) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Impossibile leggere l'allegato"));
    reader.readAsDataURL(file);
  });
}

async function loadEventDefinitions() {
  if (!canManageCalendarEvents(currentEmployee)) return;
  try {
    const payload = await api("/api/calendar-events");
    eventDefinitions = payload.events || [];
    eventList.innerHTML = eventDefinitions.length ? eventDefinitions.map((event) => `
      <div class="calendar-event-list-row">
        <div>
          <strong>${escapeHtml(event.title)}</strong>
          <small>${escapeHtml(formatEventDefinition(event))}${event.room ? ` · ${escapeHtml(event.room)}` : ""}</small>
        </div>
        <div class="calendar-event-list-actions">
          ${event.publicEnabled ? `<small class="public-event-badge">Pubblicato ${event.publishDaysBefore || 0} giorni prima</small>` : ""}
          <button class="ghost" type="button" data-edit-calendar-event="${event.id}">Modifica</button>
          <button class="danger ghost" type="button" data-delete-calendar-event="${event.id}">Elimina</button>
        </div>
      </div>
    `).join("") : `<p class="empty compact-empty">Nessun evento inserito.</p>`;
  } catch (error) {
    eventList.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

function statusClass(status) {
  return String(status || "").replace(/\s+/g, "-");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

async function loadCalendar() {
  const { from, to } = rangeForView();
  calendarGrid.innerHTML = `<p class="empty compact-empty">Caricamento calendario...</p>`;
  const payload = await api(`/api/calendar?from=${from}&to=${to}`);
  calendarItems = payload.items || [];
  renderCalendar();
}

async function movePeriod(direction) {
  if (viewMode.value === "month") {
    const date = new Date(`${dateInput.value}T12:00:00`);
    date.setDate(1);
    date.setMonth(date.getMonth() + direction);
    dateInput.value = date.toISOString().slice(0, 10);
  } else {
    const delta = viewMode.value === "day" ? direction : direction * 7;
    dateInput.value = addDays(dateInput.value, delta);
  }
  await loadCalendar();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const data = Object.fromEntries(new FormData(loginForm).entries());
  try {
    const payload = await api("/api/login", { method: "POST", body: JSON.stringify(data) });
    csrfToken = payload.csrfToken;
    if (!canViewCalendar(payload.employee)) {
      loginError.textContent = "Questo accesso non ha il permesso calendario.";
      return;
    }
    showCalendar(payload.employee);
    await loadCalendar();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  csrfToken = "";
  calendarItems = [];
  loginForm.reset();
  showLogin();
});

openEventManagerButton.addEventListener("click", openEventManager);

prevButton.addEventListener("click", () => movePeriod(-1));
nextButton.addEventListener("click", () => movePeriod(1));
todayButton.addEventListener("click", async () => {
  dateInput.value = today;
  await loadCalendar();
});
dateInput.addEventListener("change", loadCalendar);
viewMode.addEventListener("change", loadCalendar);
[roomFilter, statusFilter, typeFilter].forEach((filter) => {
  filter.addEventListener("change", renderCalendar);
});

calendarGrid.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-calendar-id]");
  if (!button) return;
  const item = calendarItems.find((entry) => entry.id === button.dataset.calendarId);
  if (item) renderDetail(item);
});

eventForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  eventError.textContent = "";
  try {
    const formData = new FormData(eventForm);
    const data = Object.fromEntries(formData.entries());
    data.publicEnabled = eventForm.elements.publicEnabled.checked;
    data.bookingEnabled = eventForm.elements.bookingEnabled.checked;
    data.posterData = await fileAsDataUrl(eventForm.elements.posterFile.files[0]);
    data.menuData = await fileAsDataUrl(eventForm.elements.menuFile.files[0]);
    delete data.posterFile;
    delete data.menuFile;
    const id = data.id;
    delete data.id;
    await api(id ? `/api/calendar-events/${id}` : "/api/calendar-events", { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
    resetEventForm();
    await Promise.all([loadEventDefinitions(), loadCalendar()]);
  } catch (error) {
    eventError.textContent = error.message;
  }
});

async function deleteCalendarEvent(id) {
  if (!id || !window.confirm("Eliminare questo evento dal calendario?")) return;
  await api(`/api/calendar-events/${id}`, { method: "DELETE" });
  calendarDetail.innerHTML = `<p class="empty">Seleziona un blocco per vedere il dettaglio.</p>`;
  await Promise.all([loadEventDefinitions(), loadCalendar()]);
}

document.addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-edit-calendar-event]");
  if (editButton) {
    const item = eventDefinitions.find((entry) => entry.id === editButton.dataset.editCalendarEvent);
    if (item) editEventDefinition(item);
    return;
  }
  const button = event.target.closest("[data-delete-calendar-event]");
  if (!button) return;
  deleteCalendarEvent(button.dataset.deleteCalendarEvent).catch((error) => {
    eventError.textContent = error.message;
  });
});

eventForm.elements.publicEnabled.addEventListener("change", syncPublicEventFields);
document.querySelector("[data-reset-calendar-event]").addEventListener("click", resetEventForm);

await loadBrandConfig();
const me = await api("/api/me").catch(() => ({ employee: null }));
if (me.employee && canViewCalendar(me.employee)) {
  csrfToken = me.csrfToken;
  showCalendar(me.employee);
  await loadCalendar();
} else {
  showLogin();
}
