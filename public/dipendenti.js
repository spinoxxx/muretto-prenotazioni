const loginView = document.querySelector("#employeeReferralLoginView");
const referralView = document.querySelector("#employeeReferralView");
const loginForm = document.querySelector("#employeeReferralLoginForm");
const loginError = document.querySelector("#employeeReferralLoginError");
const referralForm = document.querySelector("#employeeReferralForm");
const employeeName = document.querySelector("#employeeReferralName");
const logoutButton = document.querySelector("#employeeReferralLogoutButton");
const bookingDate = document.querySelector("#employeeReferralDate");
const bookingDateDisplay = document.querySelector("#employeeReferralDateDisplay");
const gardenRequest = document.querySelector("#employeeGardenRequest");
const timeSlots = document.querySelector("#employeeReferralTimeSlots");
const message = document.querySelector("#employeeReferralMessage");
const zonePreviewCards = document.querySelectorAll("[data-zone-preview]");

let csrfToken = "";
let timeSlotRequestId = 0;

const today = new Date().toISOString().slice(0, 10);
bookingDate.min = today;
bookingDate.value = today;
referralForm.elements.people.value = 2;
updateDateDisplay();

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Operazione non riuscita");
  return payload;
}

function showLogin() {
  loginView.hidden = false;
  loginView.style.display = "";
  referralView.hidden = true;
}

function showReferral(employee) {
  employeeName.textContent = employee.name;
  loginView.hidden = true;
  loginView.style.display = "none";
  referralView.hidden = false;
}

function activeConsumption() {
  return referralForm.elements.consumption.value;
}

function slotParams() {
  const params = new URLSearchParams({
    date: bookingDate.value,
    consumption: activeConsumption(),
    gardenRequested: referralForm.elements.gardenRequested.checked ? "true" : "false",
    people: referralForm.elements.people.value || "2",
    language: "it"
  });
  return params.toString();
}

function updateDateDisplay() {
  bookingDateDisplay.textContent = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(`${bookingDate.value}T12:00:00`))
    .replace(/\./g, "");
}

function syncGardenRequest() {
  const isDinner = activeConsumption() === "cena";
  gardenRequest.hidden = !isDinner;
  if (!isDinner) referralForm.elements.gardenRequested.checked = false;
  syncZonePreview();
  loadTimeSlots();
}

function syncZonePreview() {
  const selectedZone = referralForm.elements.gardenRequested.checked && activeConsumption() === "cena" ? "garden" : "";
  zonePreviewCards.forEach((card) => {
    const selected = card.dataset.zonePreview === selectedZone;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-current", selected ? "true" : "false");
  });
}

function selectTimeSlot(time) {
  referralForm.elements.time.value = time;
  timeSlots.querySelectorAll("button").forEach((button) => {
    const selected = button.dataset.time === time;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

async function loadTimeSlots() {
  const requestId = ++timeSlotRequestId;
  referralForm.elements.time.value = "";
  timeSlots.textContent = "Carico fasce disponibili...";
  timeSlots.classList.add("is-loading");
  try {
    const payload = await api(`/api/public-booking-slots?${slotParams()}`);
    if (requestId !== timeSlotRequestId) return;
    timeSlots.classList.remove("is-loading");
    timeSlots.textContent = "";
    if (!payload.slots.length) {
      timeSlots.textContent = "Nessuna fascia disponibile per questa scelta.";
      return;
    }
    payload.slots.forEach((slot) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.time = slot.time;
      button.textContent = slot.time;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => selectTimeSlot(slot.time));
      timeSlots.append(button);
    });
  } catch (error) {
    if (requestId !== timeSlotRequestId) return;
    timeSlots.classList.remove("is-loading");
    timeSlots.textContent = error.message;
  }
}

function referralPayload() {
  const payload = Object.fromEntries(new FormData(referralForm).entries());
  payload.gardenRequested = referralForm.elements.gardenRequested.checked;
  payload.employeePrivacyAccepted = referralForm.elements.employeePrivacyAccepted.checked;
  return payload;
}

function resetReferralForm() {
  referralForm.reset();
  bookingDate.value = today;
  referralForm.elements.people.value = 2;
  referralForm.elements.time.value = "";
  updateDateDisplay();
  syncGardenRequest();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const data = Object.fromEntries(new FormData(loginForm).entries());
  try {
    const payload = await api("/api/login", { method: "POST", body: JSON.stringify(data) });
    csrfToken = payload.csrfToken;
    showReferral(payload.employee);
    await loadTimeSlots();
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

bookingDate.addEventListener("change", () => {
  updateDateDisplay();
  loadTimeSlots();
});

referralForm.elements.people.addEventListener("input", loadTimeSlots);
referralForm.querySelectorAll("input[name='consumption']").forEach((input) => {
  input.addEventListener("change", syncGardenRequest);
});
referralForm.elements.gardenRequested.addEventListener("change", syncGardenRequest);

referralForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!referralForm.elements.time.value) {
    message.textContent = "Scegli una fascia oraria.";
    return;
  }
  message.textContent = "Salvataggio in corso...";
  const submitButton = referralForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    const payload = await api("/api/employee-referral-bookings", {
      method: "POST",
      body: JSON.stringify(referralPayload())
    });
    const emailText = payload.booking.confirmationEmailSentAt ? " Email di conferma inviata." : "";
    message.textContent = `Prenotazione confermata per ${payload.booking.date} alle ${payload.booking.time}.${emailText}`;
    resetReferralForm();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

const me = await api("/api/me").catch(() => ({ employee: null }));
if (me.employee) {
  csrfToken = me.csrfToken;
  showReferral(me.employee);
  syncGardenRequest();
} else {
  showLogin();
  syncGardenRequest();
}
