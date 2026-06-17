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
const prevDayButton = document.querySelector("#prevDayButton");
const nextDayButton = document.querySelector("#nextDayButton");
const todayButton = document.querySelector("#todayButton");
const searchInput = document.querySelector("#searchInput");
const rangeLabel = document.querySelector("#rangeLabel");
const todayCount = document.querySelector("#todayCount");
const pendingCount = document.querySelector("#pendingCount");
const peopleCount = document.querySelector("#peopleCount");
const staffPanel = document.querySelector("#staffPanel");
const backupPanel = document.querySelector("#backupPanel");
const createBackupButton = document.querySelector("#createBackupButton");
const backupMessage = document.querySelector("#backupMessage");
const backupDownloadLink = document.querySelector("#backupDownloadLink");
const employeeForm = document.querySelector("#employeeForm");
const employeeList = document.querySelector("#employeeList");
const employeeMessage = document.querySelector("#employeeMessage");

let csrfToken = "";
let bookings = [];
let currentEmployee = null;

const today = new Date().toISOString().slice(0, 10);
filterDate.value = toDisplayDate(today);
bookingForm.elements.date.value = toDisplayDate(today);
bookingForm.elements.time.value = "20:00";

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

function showLogin() {
  document.body.classList.remove("is-authenticated");
  loginView.hidden = false;
  loginView.style.display = "";
  appView.hidden = true;
  appView.style.display = "none";
  staffPanel.hidden = true;
  backupPanel.hidden = true;
}

function showApp(employee) {
  currentEmployee = employee;
  document.body.classList.add("is-authenticated");
  employeeName.textContent = employee.name;
  staffPanel.hidden = employee.role !== "admin";
  backupPanel.hidden = employee.role !== "admin";
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
  const currentDate = bookingForm.elements.date.value || toDisplayDate(today);
  bookingForm.reset();
  bookingForm.elements.id.value = "";
  bookingForm.elements.date.value = currentDate;
  bookingForm.elements.time.value = "20:00";
  bookingForm.elements.people.value = 2;
  bookingForm.elements.status.value = "confermata";
  formTitle.textContent = "Nuova prenotazione";
  formMessage.textContent = "";
}

function statusClass(status) {
  return status.replace(/\s+/g, "-");
}

function matchesSearch(booking, term) {
  if (!term) return true;
  const haystack = `${booking.guestName} ${booking.phone} ${booking.email} ${booking.room} ${booking.tableNumber} ${booking.notes}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function renderBookings() {
  const term = searchInput.value.trim();
  const filtered = bookings.filter((booking) => matchesSearch(booking, term));
  const filterApiDate = toApiDate(filterDate.value);
  rangeLabel.textContent = filterApiDate ? `Data ${formatDate(filterApiDate)}` : "Tutte le date";

  todayCount.textContent = bookings.filter((booking) => booking.date === today && booking.status !== "annullata").length;
  pendingCount.textContent = bookings.filter((booking) => booking.status === "in attesa").length;
  peopleCount.textContent = filtered
    .filter((booking) => booking.status !== "annullata")
    .reduce((sum, booking) => sum + Number(booking.people || 0), 0);

  if (!filtered.length) {
    bookingList.innerHTML = `<p class="empty">Nessuna prenotazione trovata.</p>`;
    return;
  }

  bookingList.innerHTML = filtered.map((booking) => `
    <article class="booking-row">
      <div class="time">${escapeHtml(booking.time)}</div>
      <div class="booking-main">
        <h3>${escapeHtml(booking.guestName)} · ${Number(booking.people)} persone</h3>
        <p>${formatDate(booking.date)} · ${seatLine(booking)} · ${contactLine(booking)}</p>
        ${booking.notes ? `<p>${escapeHtml(booking.notes)}</p>` : ""}
        <p><span class="status ${statusClass(booking.status)}">${escapeHtml(booking.status)}</span></p>
      </div>
      <div class="actions">
        <button class="ghost" type="button" data-action="edit" data-id="${booking.id}">Modifica</button>
        <button class="delete" type="button" data-action="delete" data-id="${booking.id}">Elimina</button>
      </div>
    </article>
  `).join("");
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

function contactLine(booking) {
  const parts = [booking.phone, booking.email].filter(Boolean).map(escapeHtml);
  return parts.length ? parts.join(" · ") : "nessun recapito";
}

function seatLine(booking) {
  const parts = [];
  if (booking.room) parts.push(`Sala ${booking.room}`);
  if (booking.tableNumber) parts.push(`Tavolo ${booking.tableNumber}`);
  return parts.length ? parts.map(escapeHtml).join(" · ") : "sala/tavolo da assegnare";
}

function toDisplayDate(value) {
  if (!value) return "";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
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

function formatDateInput(value) {
  const digits = String(value).replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T12:00:00`));
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
    await loadEmployees();
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
    bookingForm.elements.date.value = toDisplayDate(booking.date);
    formMessage.textContent = "";
    bookingForm.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  if (button.dataset.action === "delete") {
    const ok = confirm(`Eliminare la prenotazione di ${booking.guestName}?`);
    if (!ok) return;
    await api(`/api/bookings/${booking.id}`, { method: "DELETE" });
    await loadBookings();
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
filterDate.addEventListener("change", loadBookings);
prevDayButton.addEventListener("click", async () => {
  filterDate.value = toDisplayDate(addDays(filterDate.value, -1));
  await loadBookings();
});
nextDayButton.addEventListener("click", async () => {
  filterDate.value = toDisplayDate(addDays(filterDate.value, 1));
  await loadBookings();
});
todayButton.addEventListener("click", async () => {
  filterDate.value = toDisplayDate(today);
  await loadBookings();
});
searchInput.addEventListener("input", renderBookings);

filterDate.addEventListener("input", () => {
  filterDate.value = formatDateInput(filterDate.value);
});

bookingForm.elements.date.addEventListener("input", () => {
  bookingForm.elements.date.value = formatDateInput(bookingForm.elements.date.value);
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
  } catch (error) {
    backupMessage.textContent = error.message;
  }
});

const me = await api("/api/me").catch(() => ({ employee: null }));
if (me.employee) {
  csrfToken = me.csrfToken;
  if (me.employee.role === "agenda") {
    window.location.href = "/agenda.html";
  } else {
  showApp(me.employee);
  await loadBookings();
  await loadEmployees();
  }
} else {
  showLogin();
}
