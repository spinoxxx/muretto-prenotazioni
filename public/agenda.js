const loginView = document.querySelector("#agendaLoginView");
const agendaView = document.querySelector("#agendaView");
const loginForm = document.querySelector("#agendaLoginForm");
const loginError = document.querySelector("#agendaLoginError");
const employeeName = document.querySelector("#agendaEmployeeName");
const logoutButton = document.querySelector("#agendaLogoutButton");
const agendaDate = document.querySelector("#agendaDate");
const agendaRangeLabel = document.querySelector("#agendaRangeLabel");
const agendaList = document.querySelector("#agendaList");

let csrfToken = "";

const today = new Date().toISOString().slice(0, 10);
agendaDate.value = toDisplayDate(today);

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
  loginView.hidden = false;
  loginView.style.display = "";
  agendaView.hidden = true;
  agendaView.style.display = "none";
}

function showAgenda(employee) {
  employeeName.textContent = employee.name;
  loginView.hidden = true;
  loginView.style.display = "none";
  agendaView.hidden = false;
  agendaView.style.display = "";
}

function renderAgenda(bookings, date) {
  agendaRangeLabel.textContent = formatDate(date);
  if (!bookings.length) {
    agendaList.innerHTML = `<p class="empty">Nessuna prenotazione in agenda.</p>`;
    return;
  }

  agendaList.innerHTML = bookings.map((booking) => `
    <article class="booking-row agenda-row">
      <div class="time">${escapeHtml(booking.time)}</div>
      <div class="booking-main">
        <h3>${escapeHtml(booking.guestName)} · ${Number(booking.people)} persone</h3>
        <p>${seatLine(booking)}</p>
        <p><span class="status ${statusClass(booking.status)}">${escapeHtml(booking.status)}</span></p>
      </div>
    </article>
  `).join("");
}

async function loadAgenda() {
  const selectedDate = toApiDate(agendaDate.value) || today;
  const payload = await api(`/api/agenda?date=${selectedDate}`);
  renderAgenda(payload.bookings, payload.date);
}

function statusClass(status) {
  return String(status || "").replace(/\s+/g, "-");
}

function seatLine(booking) {
  const parts = [];
  if (booking.room) parts.push(`Sala ${booking.room}`);
  if (booking.tableNumber) parts.push(`Tavolo ${booking.tableNumber}`);
  return parts.length ? parts.map(escapeHtml).join(" · ") : "Sala/tavolo da assegnare";
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

function formatDateInput(value) {
  const digits = String(value).replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00`));
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

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const data = Object.fromEntries(new FormData(loginForm).entries());
  try {
    const payload = await api("/api/login", { method: "POST", body: JSON.stringify(data) });
    csrfToken = payload.csrfToken;
    showAgenda(payload.employee);
    await loadAgenda();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  csrfToken = "";
  loginForm.reset();
  showLogin();
});

agendaDate.addEventListener("change", loadAgenda);
agendaDate.addEventListener("input", () => {
  agendaDate.value = formatDateInput(agendaDate.value);
});

const me = await api("/api/me").catch(() => ({ employee: null }));
if (me.employee) {
  csrfToken = me.csrfToken;
  showAgenda(me.employee);
  await loadAgenda();
} else {
  showLogin();
}
