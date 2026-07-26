const bookingForm = document.querySelector("#publicBookingForm");
const bookingDate = document.querySelector("#publicBookingDate");
const bookingDateDisplay = document.querySelector("#publicBookingDateDisplay");
const message = document.querySelector("#publicBookingMessage");
const gardenRequest = document.querySelector("#gardenRequest");
const eventBookingNotice = document.querySelector("#eventBookingNotice");
const publicEventCard = document.querySelector("#publicEventCard");
const publicTimeSlots = document.querySelector("#publicTimeSlots");
const zonePreviewCards = document.querySelectorAll("[data-zone-preview]");
const SPECIAL_EVENT_DATE = "2026-07-22";
const pageLanguage = document.documentElement.lang === "en" ? "en" : "it";
let timeSlotRequestId = 0;
const copy = {
  it: {
    apiError: "Operazione non riuscita",
    sending: "Invio richiesta in corso...",
    selectDate: "Seleziona data",
    loadingSlots: "Carico fasce disponibili...",
    noSlots: "Nessuna fascia disponibile per questa scelta.",
    chooseSlot: "Scegli una fascia oraria.",
    gardenPending: "Giardino richiesto, da confermare",
    proposedRoom: "Zona proposta",
    emailNotice: " Riceverai conferma via mail appena verificata.",
    success(date, time, roomText, emailText) {
      return `Richiesta ricevuta per ${date} alle ${time}. ${roomText}.${emailText}`;
    },
    confirmed(date, time, roomText) {
      return `Prenotazione confermata per ${date} alle ${time}. ${roomText}. Riceverai la conferma via mail.`;
    }
  },
  en: {
    apiError: "Something went wrong",
    sending: "Sending request...",
    selectDate: "Select date",
    loadingSlots: "Loading available time slots...",
    noSlots: "No time slots available for this selection.",
    chooseSlot: "Choose a time slot.",
    gardenPending: "Garden requested, to be confirmed",
    proposedRoom: "Suggested area",
    emailNotice: " You will receive confirmation by email once verified.",
    success(date, time, roomText, emailText) {
      return `Request received for ${date} at ${time}. ${roomText}.${emailText}`;
    },
    confirmed(date, time, roomText) {
      return `Booking confirmed for ${date} at ${time}. ${roomText}. You will receive confirmation by email.`;
    }
  }
}[pageLanguage];

const today = new Date().toISOString().slice(0, 10);
bookingDate.min = today;
bookingDate.value = today;
bookingForm.elements.time.value = "";
updateDateDisplay(bookingDate, bookingDateDisplay);
syncSpecialEventNotice();
syncPublicEventCard();

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || copy.apiError);
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
  document.title = brand.name ? (pageLanguage === "en" ? `Book at ${brand.name}` : `Prenota ${brand.name}`) : document.title;
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
  data.language = pageLanguage;
  data.gardenRequested = bookingForm.elements.gardenRequested.checked;
  data.privacyAccepted = bookingForm.elements.privacyAccepted.checked;
  return data;
}

function slotParams() {
  const params = new URLSearchParams({
    date: bookingDate.value,
    consumption: activeConsumption(),
    gardenRequested: bookingForm.elements.gardenRequested.checked ? "true" : "false",
    people: bookingForm.elements.people.value || "2",
    language: pageLanguage
  });
  return params.toString();
}

function activeConsumption() {
  return bookingForm.elements.consumption.value;
}

function syncGardenRequest() {
  const isDinner = activeConsumption() === "cena";
  gardenRequest.hidden = !isDinner;
  if (!isDinner) bookingForm.elements.gardenRequested.checked = false;
  syncZonePreview();
  loadTimeSlots();
}

function syncZonePreview() {
  const selectedZone = bookingForm.elements.gardenRequested.checked && activeConsumption() === "cena" ? "garden" : "";
  zonePreviewCards.forEach((card) => {
    const selected = card.dataset.zonePreview === selectedZone;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-current", selected ? "true" : "false");
  });
}

function formatDisplayDate(value) {
  if (!value) return copy.selectDate;
  const locale = pageLanguage === "en" ? "en-GB" : "it-IT";
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(`${value}T12:00:00`))
    .replace(/\./g, "");
}

function formatDate(value) {
  const locale = pageLanguage === "en" ? "en-GB" : "it-IT";
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
    .format(new Date(`${value}T12:00:00`));
}

function updateDateDisplay(input, display) {
  display.textContent = formatDisplayDate(input.value);
}

function syncSpecialEventNotice() {
  if (!eventBookingNotice) return;
  eventBookingNotice.hidden = bookingDate.value !== SPECIAL_EVENT_DATE;
}

function syncPublicEventCard() {
  if (!publicEventCard) return;
  publicEventCard.hidden = today > SPECIAL_EVENT_DATE;
}

function roomLabel(room) {
  if (pageLanguage !== "en") return room;
  if (room === "Ristorante Esterno" || room === "Ristorante") return "Outdoor Restaurant";
  if (room === "Giardino") return "Garden";
  if (room === "Interno") return "Indoor";
  return room;
}

function selectTimeSlot(time) {
  bookingForm.elements.time.value = time;
  publicTimeSlots.querySelectorAll("button").forEach((button) => {
    const selected = button.dataset.time === time;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

async function loadTimeSlots() {
  const requestId = ++timeSlotRequestId;
  bookingForm.elements.time.value = "";
  publicTimeSlots.textContent = copy.loadingSlots;
  publicTimeSlots.classList.add("is-loading");
  try {
    const payload = await api(`/api/public-booking-slots?${slotParams()}`);
    if (requestId !== timeSlotRequestId) return;
    publicTimeSlots.classList.remove("is-loading");
    publicTimeSlots.textContent = "";
    if (!payload.slots.length) {
      publicTimeSlots.textContent = copy.noSlots;
      return;
    }
    payload.slots.forEach((slot) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.time = slot.time;
      button.textContent = slot.time;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => selectTimeSlot(slot.time));
      publicTimeSlots.append(button);
    });
  } catch (error) {
    if (requestId !== timeSlotRequestId) return;
    publicTimeSlots.classList.remove("is-loading");
    publicTimeSlots.textContent = error.message;
  }
}

bookingDate.addEventListener("change", () => {
  updateDateDisplay(bookingDate, bookingDateDisplay);
  syncSpecialEventNotice();
  loadTimeSlots();
});

bookingForm.elements.people.addEventListener("input", loadTimeSlots);

bookingForm.querySelectorAll("input[name='consumption']").forEach((input) => {
  input.addEventListener("change", syncGardenRequest);
});

bookingForm.elements.gardenRequested.addEventListener("change", syncZonePreview);
bookingForm.elements.gardenRequested.addEventListener("change", loadTimeSlots);

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!bookingForm.elements.time.value) {
    message.textContent = copy.chooseSlot;
    return;
  }
  message.textContent = copy.sending;
  const submitButton = bookingForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    const request = toPayload();
    const payload = await api("/api/public-bookings", {
      method: "POST",
      body: JSON.stringify(request)
    });
    const isConfirmed = payload.booking.status === "confermata";
    const roomText = payload.booking.room === "Giardino" && !isConfirmed
      ? copy.gardenPending
      : `${copy.proposedRoom}: ${roomLabel(payload.booking.room)}`;
    const emailText = copy.emailNotice;
    message.textContent = isConfirmed
      ? copy.confirmed(formatDate(payload.booking.date), payload.booking.time, roomText)
      : copy.success(formatDate(payload.booking.date), payload.booking.time, roomText, emailText);
    bookingForm.reset();
    bookingDate.value = today;
    bookingForm.elements.time.value = "";
    bookingForm.elements.people.value = 2;
    updateDateDisplay(bookingDate, bookingDateDisplay);
    syncGardenRequest();
    syncSpecialEventNotice();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

syncGardenRequest();
await loadBrandConfig();
