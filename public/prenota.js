const bookingForm = document.querySelector("#publicBookingForm");
const bookingDate = document.querySelector("#publicBookingDate");
const bookingDateDisplay = document.querySelector("#publicBookingDateDisplay");
const message = document.querySelector("#publicBookingMessage");
const gardenRequest = document.querySelector("#gardenRequest");
const restaurantPreference = document.querySelector("#restaurantPreference");
const barPreview = document.querySelector("#barPreview");
const eventBookingNotice = document.querySelector("#eventBookingNotice");
const publicEventCard = document.querySelector("#publicEventCard");
const publicTimeSlots = document.querySelector("#publicTimeSlots");
const zonePreviewCards = document.querySelectorAll("[data-zone-preview]");
const standardFields = document.querySelectorAll("[data-standard-fields]");
const specialRequestFields = document.querySelector("#specialRequestFields");
const SPECIAL_EVENT_DATE = "2026-08-16";
const pageLanguage = document.documentElement.lang === "en" ? "en" : "it";
let timeSlotRequestId = 0;
const copy = {
  it: {
    apiError: "Operazione non riuscita",
    sending: "Invio richiesta in corso...",
    sentTitle: "Richiesta inviata",
    confirmedTitle: "Prenotazione confermata",
    failedTitle: "Richiesta non inviata",
    selectDate: "Seleziona data",
    loadingSlots: "Carico fasce disponibili...",
    noSlots: "Nessuna fascia disponibile per questa scelta.",
    chooseService: "Seleziona prima il tipo di servizio.",
    chooseSlot: "Scegli una fascia oraria.",
    gardenPending: "Giardino richiesto, da confermare",
    proposedRoom: "Zona proposta",
    emailNotice: " Riceverai conferma via mail appena verificata.",
    specialSuccess(date) {
      return `Richiesta speciale ricevuta per ${date}. Ti risponderemo via mail appena possibile.`;
    },
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
    sentTitle: "Request sent",
    confirmedTitle: "Booking confirmed",
    failedTitle: "Request not sent",
    selectDate: "Select date",
    loadingSlots: "Loading available time slots...",
    noSlots: "No time slots available for this selection.",
    chooseService: "Choose a type of visit first.",
    chooseSlot: "Choose a time slot.",
    gardenPending: "Garden requested, to be confirmed",
    proposedRoom: "Suggested area",
    emailNotice: " You will receive confirmation by email once verified.",
    specialSuccess(date) {
      return `Special request received for ${date}. We will reply by email as soon as possible.`;
    },
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

function showResult(type, title, text) {
  message.className = `message public-result-message is-${type}`;
  message.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span>`;
  message.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearResult() {
  message.className = "message";
  message.textContent = "";
}

function toPayload() {
  const data = Object.fromEntries(new FormData(bookingForm).entries());
  data.language = pageLanguage;
  data.gardenRequested = bookingForm.elements.gardenRequested?.checked || false;
  data.indoorRequested = bookingForm.elements.roomPreference?.value === "interno" && !data.gardenRequested;
  data.privacyAccepted = bookingForm.elements.privacyAccepted.checked;
  return data;
}

function isSpecialRequest() {
  return bookingForm.elements.requestType.value === "special";
}

function slotParams() {
  const params = new URLSearchParams({
    date: bookingDate.value,
    consumption: activeConsumption(),
    gardenRequested: bookingForm.elements.gardenRequested.checked ? "true" : "false",
    indoorRequested: bookingForm.elements.roomPreference?.value === "interno" ? "true" : "false",
    people: bookingForm.elements.people.value || "2",
    language: pageLanguage
  });
  return params.toString();
}

function activeConsumption() {
  return bookingForm.querySelector("input[name='consumption']:checked")?.value || "";
}

function syncGardenRequest() {
  if (isSpecialRequest()) return;
  const consumption = activeConsumption();
  const isRestaurantService = consumption === "pranzo" || consumption === "cena";
  restaurantPreference.hidden = !isRestaurantService;
  barPreview.hidden = consumption !== "aperitivo";
  if (!isRestaurantService) bookingForm.elements.roomPreference.value = "esterno";
  gardenRequest.hidden = !isRestaurantService;
  if (!isRestaurantService) bookingForm.elements.gardenRequested.checked = false;
  syncZonePreview();
  loadTimeSlots();
}

function syncZonePreview() {
  const selectedZone = bookingForm.elements.gardenRequested.checked && activeConsumption() !== "aperitivo" ? "garden" : "";
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
  eventBookingNotice.hidden = isSpecialRequest() || bookingDate.value !== SPECIAL_EVENT_DATE;
}

function syncPublicEventCard() {
  if (!publicEventCard) return;
  publicEventCard.hidden = today > SPECIAL_EVENT_DATE;
}

function roomLabel(room) {
  if (pageLanguage !== "en") return room === "Interno" ? "Sala Interna" : room;
  if (room === "Ristorante Esterno" || room === "Ristorante") return "Outdoor Restaurant";
  if (room === "Giardino") return "Garden";
  if (room === "Interno") return "Indoor room";
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
  if (isSpecialRequest()) {
    bookingForm.elements.time.value = "";
    publicTimeSlots.textContent = "";
    return;
  }
  if (!activeConsumption()) {
    bookingForm.elements.time.value = "";
    publicTimeSlots.classList.remove("is-loading");
    publicTimeSlots.textContent = copy.chooseService;
    return;
  }
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

function syncRequestType() {
  const special = isSpecialRequest();
  standardFields.forEach((element) => {
    element.hidden = special;
  });
  specialRequestFields.hidden = !special;
  bookingForm.elements.time.required = !special;
  bookingForm.elements.voucherCode.disabled = special;
  bookingForm.querySelectorAll("input[name='consumption'], input[name='roomPreference']").forEach((input) => {
    input.disabled = special;
  });
  bookingForm.elements.specialType.required = special;
  bookingForm.elements.specialTimeWindow.required = special;
  bookingForm.elements.specialType.disabled = !special;
  bookingForm.elements.specialTimeWindow.disabled = !special;
  bookingForm.elements.people.max = special ? "300" : "40";
  bookingForm.elements.notes.maxLength = special ? 1200 : 220;
  syncSpecialEventNotice();
  if (special) {
    bookingForm.elements.time.value = "";
    publicTimeSlots.textContent = "";
  } else {
    syncGardenRequest();
  }
}

bookingDate.addEventListener("change", () => {
  clearResult();
  updateDateDisplay(bookingDate, bookingDateDisplay);
  syncSpecialEventNotice();
  loadTimeSlots();
});

bookingForm.elements.people.addEventListener("input", loadTimeSlots);

bookingForm.querySelectorAll("input[name='consumption']").forEach((input) => {
  input.addEventListener("change", syncGardenRequest);
});

bookingForm.querySelectorAll("input[name='requestType']").forEach((input) => {
  input.addEventListener("change", syncRequestType);
});

bookingForm.elements.gardenRequested.addEventListener("change", syncZonePreview);
bookingForm.elements.gardenRequested.addEventListener("change", () => {
  if (bookingForm.elements.gardenRequested.checked) bookingForm.elements.roomPreference.value = "esterno";
  syncGardenRequest();
});

bookingForm.querySelectorAll("input[name='roomPreference']").forEach((input) => {
  input.addEventListener("change", () => {
    if (bookingForm.elements.roomPreference.value === "interno") bookingForm.elements.gardenRequested.checked = false;
    syncGardenRequest();
  });
});

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isSpecialRequest() && !activeConsumption()) {
    showResult("error", copy.failedTitle, copy.chooseService);
    return;
  }
  if (!isSpecialRequest() && !bookingForm.elements.time.value) {
    showResult("error", copy.failedTitle, copy.chooseSlot);
    return;
  }
  showResult("pending", copy.sending, pageLanguage === "en" ? "Please wait a moment, we are checking availability." : "Attendi un momento, stiamo verificando la disponibilità.");
  const submitButton = bookingForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    const request = toPayload();
    const payload = await api("/api/public-bookings", {
      method: "POST",
      body: JSON.stringify(request)
    });
    const isSpecial = payload.booking.requestType === "special";
    const isConfirmed = payload.booking.status === "confermata";
    const roomText = payload.booking.room === "Giardino" && !isConfirmed
      ? copy.gardenPending
      : `${copy.proposedRoom}: ${roomLabel(payload.booking.room)}`;
    const emailText = copy.emailNotice;
    const resultText = isSpecial
      ? copy.specialSuccess(formatDate(payload.booking.date))
      : isConfirmed
      ? copy.confirmed(formatDate(payload.booking.date), payload.booking.time, roomText)
      : copy.success(formatDate(payload.booking.date), payload.booking.time, roomText, emailText);
    showResult("success", isConfirmed ? copy.confirmedTitle : copy.sentTitle, resultText);
    bookingForm.reset();
    bookingDate.value = today;
    bookingForm.elements.time.value = "";
    bookingForm.elements.people.value = 2;
    updateDateDisplay(bookingDate, bookingDateDisplay);
    syncRequestType();
    syncSpecialEventNotice();
  } catch (error) {
    showResult("error", copy.failedTitle, error.message);
  } finally {
    submitButton.disabled = false;
  }
});

syncRequestType();
await loadBrandConfig();

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}
