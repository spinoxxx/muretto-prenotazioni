const loginView = document.querySelector("#agendaLoginView");
const agendaView = document.querySelector("#agendaView");
const loginForm = document.querySelector("#agendaLoginForm");
const loginError = document.querySelector("#agendaLoginError");
const employeeName = document.querySelector("#agendaEmployeeName");
const logoutButton = document.querySelector("#agendaLogoutButton");
const agendaDate = document.querySelector("#agendaDate");
const agendaDateDisplay = document.querySelector("#agendaDateDisplay");
const agendaPrevDay = document.querySelector("#agendaPrevDay");
const agendaNextDay = document.querySelector("#agendaNextDay");
const agendaToday = document.querySelector("#agendaToday");
const agendaRangeLabel = document.querySelector("#agendaRangeLabel");
const agendaList = document.querySelector("#agendaList");
const agendaStatCards = document.querySelectorAll("[data-agenda-room-filter]");
const agendaRoomStats = {
  ristorante: {
    people: document.querySelector("#agendaRestaurantPeople"),
    bookings: document.querySelector("#agendaRestaurantBookings")
  },
  bar: {
    people: document.querySelector("#agendaBarPeople"),
    bookings: document.querySelector("#agendaBarBookings")
  },
  giardino: {
    people: document.querySelector("#agendaGardenPeople"),
    bookings: document.querySelector("#agendaGardenBookings")
  }
};

let csrfToken = "";
let agendaBookings = [];
let activeRoomFilter = "";

const today = new Date().toISOString().slice(0, 10);
agendaDate.value = today;
updateDateDisplay(agendaDate, agendaDateDisplay);

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
  document.title = brand.name ? `Agenda ${brand.name}` : document.title;
  setText("[data-brand-name]", brand.name);
  setText("[data-brand-monogram]", brand.monogram);
  setText("[data-brand-agenda-description]", brand.agendaDescription);

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
  const filtered = bookings.filter(matchesRoomFilter);
  const roomLabel = activeRoomFilter ? ` · ${roomFilterLabel(activeRoomFilter)}` : "";
  agendaRangeLabel.textContent = `${formatDate(date)}${roomLabel}`;
  renderRoomStats(bookings);
  renderRoomFilterState();

  if (!filtered.length) {
    agendaList.innerHTML = `<p class="empty">Nessuna prenotazione in agenda.</p>`;
    return;
  }

  agendaList.innerHTML = filtered.map((booking) => `
    <article class="booking-row agenda-row ${booking.status === "arrivati" ? "is-arrived" : ""}">
      <div class="time">${escapeHtml(booking.time)}</div>
      <div class="booking-main">
        <h3>${escapeHtml(booking.guestName)} · ${Number(booking.people)} persone</h3>
        <p>${seatLine(booking)}</p>
        ${booking.notes ? `<p class="agenda-notes"><strong>Note</strong> ${escapeHtml(booking.notes)}</p>` : ""}
        <p><span class="status ${statusClass(booking.status)}">${escapeHtml(booking.status)}</span></p>
        <form class="table-assignment" data-booking-id="${booking.id}">
          <label>
            Tavolo
            <input name="tableNumber" type="text" maxlength="30" value="${escapeAttribute(booking.tableNumber)}" placeholder="Es. 12">
          </label>
          <button class="ghost compact" type="submit">Salva tavolo</button>
          <span class="row-message" role="status"></span>
        </form>
        <button class="arrived compact arrived-agenda-button" type="button" data-action="arrived" data-id="${booking.id}">${booking.status === "arrivati" ? "ANNULLA ARRIVO" : "ARRIVATI"}</button>
      </div>
    </article>
  `).join("");
}

async function loadAgenda() {
  const selectedDate = toApiDate(agendaDate.value) || today;
  const payload = await api(`/api/agenda?date=${selectedDate}`);
  agendaBookings = payload.bookings;
  renderAgenda(agendaBookings, payload.date);
}

function statusClass(status) {
  return String(status || "").replace(/\s+/g, "-");
}

function matchesRoomFilter(booking) {
  if (!activeRoomFilter) return true;
  return String(booking.room || "").trim().toLowerCase() === activeRoomFilter;
}

function renderRoomStats(bookings) {
  const stats = {
    ristorante: createRoomStat(),
    bar: createRoomStat(),
    giardino: createRoomStat()
  };

  for (const booking of bookings) {
    const room = String(booking.room || "").trim().toLowerCase();
    if (!stats[room]) continue;
    stats[room].people += Number(booking.people || 0);
    stats[room].bookings += 1;
  }

  for (const [room, values] of Object.entries(stats)) {
    agendaRoomStats[room].people.textContent = values.people;
    agendaRoomStats[room].bookings.textContent = `${values.bookings} ${values.bookings === 1 ? "prenotazione" : "prenotazioni"}`;
  }
}

function createRoomStat() {
  return { people: 0, bookings: 0 };
}

function roomFilterLabel(room) {
  const labels = {
    ristorante: "Ristorante",
    bar: "Bar",
    giardino: "Giardino"
  };
  return labels[room] || room;
}

function renderRoomFilterState() {
  agendaStatCards.forEach((card) => {
    const isActive = card.dataset.agendaRoomFilter === activeRoomFilter;
    card.classList.toggle("is-active", isActive);
    card.setAttribute("aria-pressed", String(isActive));
  });
}

function seatLine(booking) {
  const parts = [];
  if (booking.room) parts.push(`Sala ${booking.room}`);
  if (booking.tableNumber) parts.push(`Tavolo ${booking.tableNumber}`);
  return parts.length ? parts.map(escapeHtml).join(" · ") : "Sala/tavolo da assegnare";
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

function formatDate(value) {
  return new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00`));
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

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
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

agendaDate.addEventListener("change", async () => {
  updateDateDisplay(agendaDate, agendaDateDisplay);
  await loadAgenda();
});
agendaPrevDay.addEventListener("click", async () => {
  agendaDate.value = addDays(agendaDate.value, -1);
  updateDateDisplay(agendaDate, agendaDateDisplay);
  await loadAgenda();
});
agendaNextDay.addEventListener("click", async () => {
  agendaDate.value = addDays(agendaDate.value, 1);
  updateDateDisplay(agendaDate, agendaDateDisplay);
  await loadAgenda();
});
agendaToday.addEventListener("click", async () => {
  agendaDate.value = today;
  updateDateDisplay(agendaDate, agendaDateDisplay);
  await loadAgenda();
});

agendaStatCards.forEach((card) => {
  const toggleRoomFilter = () => {
    const room = card.dataset.agendaRoomFilter;
    activeRoomFilter = activeRoomFilter === room ? "" : room;
    const selectedDate = toApiDate(agendaDate.value) || today;
    renderAgenda(agendaBookings, selectedDate);
  };
  card.addEventListener("click", toggleRoomFilter);
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleRoomFilter();
  });
});

agendaList.addEventListener("submit", async (event) => {
  const form = event.target.closest(".table-assignment");
  if (!form) return;
  event.preventDefault();
  const message = form.querySelector(".row-message");
  const button = form.querySelector("button");
  const tableNumber = form.elements.tableNumber.value;
  message.textContent = "Salvataggio...";
  button.disabled = true;
  try {
    await api(`/api/bookings/${form.dataset.bookingId}/table`, {
      method: "PATCH",
      body: JSON.stringify({ tableNumber })
    });
    message.textContent = "Tavolo salvato.";
    await loadAgenda();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

agendaList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action='arrived']");
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    await api(`/api/bookings/${button.dataset.id}/arrived`, {
      method: "PATCH",
      body: JSON.stringify({})
    });
    await loadAgenda();
  } catch (error) {
    button.disabled = false;
    button.textContent = error.message;
  }
});

await loadBrandConfig();

const me = await api("/api/me").catch(() => ({ employee: null }));
if (me.employee) {
  csrfToken = me.csrfToken;
  showAgenda(me.employee);
  await loadAgenda();
} else {
  showLogin();
}
