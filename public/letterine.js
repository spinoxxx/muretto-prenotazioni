const en = document.documentElement.lang === "en";
const label = (it, english) => en ? english : it;
const eventId = "17cbac80-aacc-4b86-82d3-8d9e9792d0da";

document.addEventListener("click", (event) => {
  if (!event.target.closest(`[data-book-public-event="${eventId}"]`)) return;
  event.preventDefault();
  event.stopPropagation();
  openWorkshopForm();
}, true);

function openWorkshopForm() {
  const dialog = document.createElement("dialog");
  dialog.className = "letterine-dialog";
  dialog.setAttribute("aria-labelledby", "letterine-title");
  dialog.innerHTML = `
    <form class="public-booking-form" autocomplete="on">
      <div class="public-event-actions">
        <h2 id="letterine-title">Biscotti e Letterine</h2>
        <button type="button" class="ghost" aria-label="${label("Chiudi", "Close")}">&times;</button>
      </div>
      <p>${label("8 dicembre, ore 15:00 · 15 € a bambino", "8 December, 3:00 pm · €15 per child")}</p>
      <label>${label("Nome e cognome dell'adulto", "Adult's full name")}<input name="guestName" autocomplete="name" maxlength="80" required></label>
      <label>Email<input name="email" type="email" autocomplete="email" maxlength="120" required></label>
      <label>${label("Telefono (facoltativo)", "Phone (optional)")}<input name="phone" type="tel" autocomplete="tel" maxlength="40"></label>
      <label>${label("Numero di bambini", "Number of children")}<input name="people" type="number" min="1" max="40" value="1" required></label>
      <label>${label("Note (facoltative)", "Notes (optional)")}<textarea name="notes" maxlength="420"></textarea></label>
      <label class="calendar-event-public-toggle"><input name="privacyAccepted" type="checkbox" required>
        <span>${label("Ho letto l'", "I have read the ")}<a href="/privacy.html" target="_blank" rel="noopener">${label("informativa privacy", "privacy notice")}</a>.</span>
      </label>
      <input name="website" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button type="submit">${label("Invia richiesta", "Send request")}</button>
      <p role="status"></p>
    </form>`;
  const form = dialog.querySelector("form");
  const submit = form.querySelector("[type=submit]");
  const status = form.querySelector("[role=status]");
  form.querySelector("[type=button]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = label("Invio in corso...", "Sending...");
    try {
      const response = await fetch("/api/public-bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), letterineBooking: true, language: en ? "en" : "it" })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      status.textContent = label("Richiesta ricevuta. Ti risponderemo via email per confermare i posti.", "Request received. We will reply by email to confirm your places.");
      status.scrollIntoView({ block: "nearest" });
    } catch (error) {
      status.textContent = error.message || label("Invio non riuscito.", "Could not send the request.");
      submit.disabled = false;
    }
  });
  document.body.append(dialog);
  dialog.showModal();
}
