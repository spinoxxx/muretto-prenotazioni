const bookingForm = document.querySelector("#publicBookingForm");
const bookingDate = document.querySelector("#publicBookingDate");
const bookingDateDisplay = document.querySelector("#publicBookingDateDisplay");
const message = document.querySelector("#publicBookingMessage");
const gardenRequest = document.querySelector("#gardenRequest");

const today = new Date().toISOString().slice(0, 10);
bookingDate.min = today;
bookingDate.value = today;
bookingForm.elements.time.value = "20:00";
updateDateDisplay(bookingDate, bookingDateDisplay);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
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
  document.title = brand.name ? `Prenota ${brand.name}` : document.title;
  setText("[data-brand-name]", brand.name);
  setText("[data-brand-category]", brand.category);
  setText("[data-brand-monogram]", brand.monogram);

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

function toPayload() {
  const data = Object.fromEntries(new FormData(bookingForm).entries());
  data.gardenRequested = bookingForm.elements.gardenRequested.checked;
  data.privacyAccepted = bookingForm.elements.privacyAccepted.checked;
  return data;
}

function activeConsumption() {
  return bookingForm.elements.consumption.value;
}

function syncGardenRequest() {
  const isDinner = activeConsumption() === "cena";
  gardenRequest.hidden = !isDinner;
  if (!isDinner) bookingForm.elements.gardenRequested.checked = false;
  if (isDinner && !bookingForm.elements.time.value) bookingForm.elements.time.value = "20:00";
  if (!isDinner && bookingForm.elements.time.value === "20:00") bookingForm.elements.time.value = "18:30";
}

function formatDisplayDate(value) {
  if (!value) return "Seleziona data";
  return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(`${value}T12:00:00`))
    .replace(/\./g, "");
}

function formatDate(value) {
  return new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
    .format(new Date(`${value}T12:00:00`));
}

function updateDateDisplay(input, display) {
  display.textContent = formatDisplayDate(input.value);
}

bookingDate.addEventListener("change", () => {
  updateDateDisplay(bookingDate, bookingDateDisplay);
});

bookingForm.querySelectorAll("input[name='consumption']").forEach((input) => {
  input.addEventListener("change", syncGardenRequest);
});

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "Invio richiesta in corso...";
  const submitButton = bookingForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    const request = toPayload();
    const payload = await api("/api/public-bookings", {
      method: "POST",
      body: JSON.stringify(request)
    });
    const roomText = payload.booking.room === "Giardino" ? "Giardino richiesto, da confermare" : `Zona proposta: ${payload.booking.room}`;
    const emailText = request.email ? " Riceverai conferma via mail appena verificata." : "";
    message.textContent = `Richiesta ricevuta per ${formatDate(payload.booking.date)} alle ${payload.booking.time}. ${roomText}.${emailText}`;
    bookingForm.reset();
    bookingDate.value = today;
    bookingForm.elements.time.value = "20:00";
    bookingForm.elements.people.value = 2;
    updateDateDisplay(bookingDate, bookingDateDisplay);
    syncGardenRequest();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

syncGardenRequest();
await loadBrandConfig();
