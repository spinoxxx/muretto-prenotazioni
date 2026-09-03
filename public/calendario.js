const loginView = document.querySelector("#calendarLoginView");
const calendarView = document.querySelector("#calendarView");
const loginForm = document.querySelector("#calendarLoginForm");
const loginError = document.querySelector("#calendarLoginError");
const employeeName = document.querySelector("#calendarEmployeeName");
const logoutButton = document.querySelector("#calendarLogoutButton");
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

let csrfToken = "";
let currentEmployee = null;
let calendarItems = [];
const today = new Date().toISOString().slice(0, 10);
dateInput.value = today;

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

function rangeForView() {
  if (viewMode.value === "day") return { from: dateInput.value, to: dateInput.value };
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
  classes.push(item.requestType === "special" ? "is-special" : "is-standard");
  if (item.status === "annullata" || item.specialStatus === "annullata") classes.push("is-cancelled");
  if (item.status === "in attesa") classes.push("is-waiting");
  if (item.room === "Bar") classes.push("is-bar-room");
  return classes.join(" ");
}

function renderCalendar() {
  const { from, to } = rangeForView();
  rangeLabel.textContent = viewMode.value === "day"
    ? formatDate(from)
    : `${formatDate(from)} - ${formatDate(to)}`;
  const days = viewMode.value === "day"
    ? [dateInput.value]
    : Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(dateInput.value), index));
  const items = visibleItems();

  calendarGrid.classList.toggle("is-day-view", viewMode.value === "day");
  calendarGrid.innerHTML = days.map((day) => {
    const dayItems = items.filter((item) => item.date === day);
    return `
      <section class="calendar-day">
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
  const delta = viewMode.value === "day" ? direction : direction * 7;
  dateInput.value = addDays(dateInput.value, delta);
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

await loadBrandConfig();
const me = await api("/api/me").catch(() => ({ employee: null }));
if (me.employee && canViewCalendar(me.employee)) {
  csrfToken = me.csrfToken;
  showCalendar(me.employee);
  await loadCalendar();
} else {
  showLogin();
}
