const bookingForm = document.querySelector("#publicBookingForm");
const bookingDate = document.querySelector("#publicBookingDate");
const bookingDateDisplay = document.querySelector("#publicBookingDateDisplay");
const message = document.querySelector("#publicBookingMessage");
const gardenRequest = document.querySelector("#gardenRequest");
const restaurantPreference = document.querySelector("#restaurantPreference");
const barPreview = document.querySelector("#barPreview");
const brunchPreview = document.querySelector("#brunchPreview");
const eventBookingNotice = document.querySelector("#eventBookingNotice");
const publicEvents = document.querySelector("#publicEvents");
const publicTimeSlots = document.querySelector("#publicTimeSlots");
const zonePreviewCards = document.querySelectorAll("[data-zone-preview]");
const standardFields = document.querySelectorAll("[data-standard-fields]");
const specialRequestFields = document.querySelector("#specialRequestFields");
const pageLanguage = document.documentElement.lang === "en" ? "en" : "it";
let timeSlotRequestId = 0;
let selectedPublicEvent = null;
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
  brunchPreview.hidden = consumption !== "brunch";
  if (!isRestaurantService) bookingForm.elements.roomPreference.value = "esterno";
  gardenRequest.hidden = !isRestaurantService;
  if (!isRestaurantService) bookingForm.elements.gardenRequested.checked = false;
  syncZonePreview();
  loadTimeSlots();
}

function syncZonePreview() {
  const selectedZone = bookingForm.elements.gardenRequested.checked && !["aperitivo", "brunch"].includes(activeConsumption()) ? "garden" : "";
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
  const visible = !isSpecialRequest() && selectedPublicEvent?.date === bookingDate.value;
  eventBookingNotice.hidden = !visible;
  if (visible) {
    const intro = pageLanguage === "en" ? "You are booking for" : "Stai prenotando per";
    const detail = [formatDate(selectedPublicEvent.date), selectedPublicEvent.time, selectedPublicEvent.priceLabel].filter(Boolean).join(" · ");
    eventBookingNotice.innerHTML = `<strong>${escapeHtml(intro)} ${escapeHtml(selectedPublicEvent.title)}.</strong><span>${escapeHtml(detail)}</span>`;
  }
}

async function loadPublicEvents() {
  if (!publicEvents) return;
  try {
    const payload = await api("/api/public-events");
    const events = [...(payload.events || [])].sort((a, b) => {
      const aIsTasting = /degustazione|tasting/i.test(a.title || "");
      const bIsTasting = /degustazione|tasting/i.test(b.title || "");
      if (aIsTasting !== bIsTasting) return aIsTasting ? -1 : 1;
      return `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
    });
    publicEvents.hidden = !events.length;
    const cards = events.map((item, index) => {
      const description = pageLanguage === "en" ? (item.descriptionEn || item.description) : item.description;
      const price = pageLanguage === "en" ? (item.priceLabelEn || item.priceLabel) : item.priceLabel;
      const menuLabel = pageLanguage === "en" ? item.menuLabelEn : item.menuLabel;
      return `<article class="public-event-card" data-event-slide="${index}" aria-label="${index + 1} / ${events.length}">
        ${item.posterUrl ? `<img src="${escapeHtml(item.posterUrl)}" alt="${escapeHtml(item.title)}" loading="lazy">` : ""}
        <div>
          <p class="eyebrow">${pageLanguage === "en" ? "Special event" : "Evento speciale"}</p>
          <h2>${escapeHtml(item.title)}</h2>
          <p><strong>${escapeHtml(formatDate(item.date))}${item.time ? ` · ${escapeHtml(item.time)}` : ""}</strong></p>
          ${description ? `<div class="event-description-wrap">
            <p class="event-description is-collapsed">${escapeHtml(description)}</p>
            <button class="event-description-toggle" type="button" hidden>${pageLanguage === "en" ? "Continue reading" : "Continua a leggere"}</button>
          </div>` : ""}
          ${price ? `<p class="event-price">${escapeHtml(price)}</p>` : ""}
          <div class="public-event-actions">
            ${item.menuUrl ? `<a class="ghost-link" href="${escapeHtml(item.menuUrl)}" target="_blank" rel="noopener">${escapeHtml(menuLabel)}</a>` : ""}
            ${item.bookingEnabled ? `<button type="button" data-book-public-event="${escapeHtml(item.id)}">${pageLanguage === "en" ? "Book this event" : "Prenota l'evento"}</button>` : ""}
          </div>
        </div>
      </article>`;
    }).join("");
    const previousLabel = pageLanguage === "en" ? "Previous event" : "Evento precedente";
    const nextLabel = pageLanguage === "en" ? "Next event" : "Evento successivo";
    publicEvents.innerHTML = `
      <div class="public-events-heading">
        <p class="eyebrow">${pageLanguage === "en" ? "Upcoming events" : "Prossimi eventi"}</p>
        ${events.length > 1 ? `<div class="public-events-controls">
          <button class="ghost icon-button" type="button" data-event-previous aria-label="${previousLabel}" title="${previousLabel}">‹</button>
          <button class="ghost icon-button" type="button" data-event-next aria-label="${nextLabel}" title="${nextLabel}">›</button>
        </div>` : ""}
      </div>
      <div class="public-events-viewport" data-events-viewport tabindex="0">
        <div class="public-events-track">${cards}</div>
      </div>
      ${events.length > 1 ? `<div class="public-events-dots" aria-label="${pageLanguage === "en" ? "Choose event" : "Scegli evento"}">
        ${events.map((item, index) => `<button type="button" data-event-dot="${index}" aria-label="${escapeHtml(item.title)}" aria-current="${index === 0 ? "true" : "false"}"></button>`).join("")}
      </div>` : ""}`;

    const viewport = publicEvents.querySelector("[data-events-viewport]");
    const slides = [...publicEvents.querySelectorAll("[data-event-slide]")];
    const dots = [...publicEvents.querySelectorAll("[data-event-dot]")];
    let activeSlide = 0;

    publicEvents.querySelectorAll(".event-description-wrap").forEach((wrap) => {
      const description = wrap.querySelector(".event-description");
      const toggle = wrap.querySelector(".event-description-toggle");
      if (description.scrollHeight > description.clientHeight + 1) toggle.hidden = false;
      toggle.addEventListener("click", () => {
        const expanded = description.classList.toggle("is-expanded");
        description.classList.toggle("is-collapsed", !expanded);
        toggle.textContent = expanded
          ? (pageLanguage === "en" ? "Show less" : "Mostra meno")
          : (pageLanguage === "en" ? "Continue reading" : "Continua a leggere");
      });
    });

    function showSlide(index, behavior = "smooth") {
      activeSlide = (index + slides.length) % slides.length;
      viewport.scrollTo({ left: activeSlide * viewport.clientWidth, behavior });
      dots.forEach((dot, dotIndex) => dot.setAttribute("aria-current", dotIndex === activeSlide ? "true" : "false"));
    }

    publicEvents.querySelector("[data-event-previous]")?.addEventListener("click", () => showSlide(activeSlide - 1));
    publicEvents.querySelector("[data-event-next]")?.addEventListener("click", () => showSlide(activeSlide + 1));
    dots.forEach((dot) => dot.addEventListener("click", () => showSlide(Number(dot.dataset.eventDot))));
    viewport.addEventListener("scroll", () => {
      const index = Math.round(viewport.scrollLeft / Math.max(1, viewport.clientWidth));
      if (index === activeSlide || index < 0 || index >= slides.length) return;
      activeSlide = index;
      dots.forEach((dot, dotIndex) => dot.setAttribute("aria-current", dotIndex === activeSlide ? "true" : "false"));
    }, { passive: true });
    publicEvents.addEventListener("click", (event) => {
      const button = event.target.closest("[data-book-public-event]");
      if (!button) return;
      const item = events.find((entry) => entry.id === button.dataset.bookPublicEvent);
      if (!item) return;
      selectedPublicEvent = item;
      bookingForm.elements.calendarEventId.value = item.id;
      bookingForm.elements.calendarEventTitle.value = item.title;
      bookingDate.value = item.date;
      updateDateDisplay(bookingDate, bookingDateDisplay);
      const consumption = item.room === "Bar" ? "aperitivo" : ((Number(item.time?.slice(0, 2)) || 20) < 17 ? "pranzo" : "cena");
      const option = bookingForm.querySelector(`input[name='consumption'][value='${consumption}']`);
      if (option) option.checked = true;
      syncGardenRequest();
      syncSpecialEventNotice();
      bookingForm.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  } catch {
    publicEvents.hidden = true;
  }
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
  if (selectedPublicEvent?.date !== bookingDate.value) {
    selectedPublicEvent = null;
    bookingForm.elements.calendarEventId.value = "";
    bookingForm.elements.calendarEventTitle.value = "";
  }
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

document.querySelectorAll("[data-standard-booking-link]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    bookingForm.querySelector("input[name='requestType'][value='standard']").checked = true;
    selectedPublicEvent = null;
    bookingForm.elements.calendarEventId.value = "";
    bookingForm.elements.calendarEventTitle.value = "";
    syncRequestType();
    bookingForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });
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
    selectedPublicEvent = null;
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
await loadPublicEvents();

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}
