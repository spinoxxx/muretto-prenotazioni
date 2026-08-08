const form = document.querySelector("#feedbackForm");
const loading = document.querySelector("#feedbackLoading");
const thankYou = document.querySelector("#feedbackThankYou");
const message = document.querySelector("#feedbackMessage");
const commentField = document.querySelector("#feedbackCommentField");
const comment = form.elements.comment;
const rating = form.elements.rating;
const submitButton = document.querySelector("#feedbackSubmit");
const googleReviewLink = document.querySelector("#googleReviewLink");

const token = new URLSearchParams(window.location.search).get("token") || "";
let language = "it";
let googleReviewUrl = "";

const copy = {
  it: {
    intro: "La tua opinione conta davvero.",
    title: "Com'è andata?",
    description: "Un minuto del tuo tempo ci aiuta a migliorare.",
    rating: "Quanto sei soddisfatto della tua esperienza?",
    choose: "Scegli un punteggio",
    lowLabel: "Ci dispiace. Cosa possiamo migliorare?",
    lowPlaceholder: "Raccontaci cosa è successo",
    submit: "Invia il feedback",
    sending: "Invio in corso…",
    thanksTitle: "Grazie per il tuo tempo.",
    thanksText: "La tua risposta è stata registrata e sarà letta dal nostro staff.",
    lowThanks: "Ci dispiace che qualcosa non sia andato come doveva. Il tuo commento sarà letto dal nostro staff.",
    review: "Lascia una recensione su Google",
    already: "Questo feedback è già stato inviato. Grazie.",
    invalid: "Questo link feedback non è valido o non è più disponibile."
  },
  en: {
    intro: "Your opinion truly matters.",
    title: "How was your experience?",
    description: "One minute of your time helps us improve.",
    rating: "How satisfied were you with your experience?",
    choose: "Choose a rating",
    lowLabel: "We are sorry to hear that. What could we improve?",
    lowPlaceholder: "Tell us what happened",
    submit: "Send feedback",
    sending: "Sending…",
    thanksTitle: "Thank you for your time.",
    thanksText: "Your response has been recorded and will be read by our team.",
    lowThanks: "We are sorry something fell short. Your comment will be read by our team.",
    review: "Leave a Google review",
    already: "This feedback has already been sent. Thank you.",
    invalid: "This feedback link is invalid or no longer available."
  }
};

function text(id, value) {
  document.querySelector(id).textContent = value;
}

function applyCopy() {
  const words = copy[language];
  document.documentElement.lang = language;
  document.title = language === "en" ? "Your experience at Muretto" : "La tua esperienza al Muretto";
  text("#feedbackIntro", words.intro);
  text("#feedbackTitle", words.title);
  text("#feedbackDescription", words.description);
  text("#ratingLabel", words.rating);
  rating.options[0].textContent = words.choose;
  text("#feedbackCommentLabel", words.lowLabel);
  comment.placeholder = words.lowPlaceholder;
  submitButton.textContent = words.submit;
  text("#feedbackThankYouTitle", words.thanksTitle);
  text("#feedbackThankYouText", words.thanksText);
  googleReviewLink.textContent = words.review;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || copy[language].invalid);
  return payload;
}

function showThankYou({ ratingValue = 0, already = false } = {}) {
  loading.hidden = true;
  form.hidden = true;
  thankYou.hidden = false;
  const words = copy[language];
  text("#feedbackThankYouText", already
    ? words.already
    : Number(ratingValue) <= 3 ? words.lowThanks : words.thanksText);
  if (googleReviewUrl) {
    googleReviewLink.href = googleReviewUrl;
    googleReviewLink.hidden = false;
  }
}

function syncCommentField() {
  const isLow = Number(rating.value) <= 3 && rating.value !== "";
  commentField.hidden = !isLow;
  comment.required = isLow;
}

rating.addEventListener("change", syncCommentField);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const ratingValue = Number(rating.value);
  if (!ratingValue) return;
  message.textContent = copy[language].sending;
  submitButton.disabled = true;
  try {
    const payload = await api("/api/feedback", {
      method: "POST",
      body: JSON.stringify({ token, rating: ratingValue, comment: comment.value })
    });
    googleReviewUrl = payload.googleReviewUrl || googleReviewUrl;
    showThankYou({ ratingValue });
  } catch (error) {
    message.textContent = error.message;
    submitButton.disabled = false;
  }
});

if (!token) {
  loading.textContent = copy.it.invalid;
} else {
  try {
    const payload = await api(`/api/feedback?token=${encodeURIComponent(token)}`);
    language = payload.feedback.language === "en" ? "en" : "it";
    googleReviewUrl = payload.googleReviewUrl || "";
    applyCopy();
    if (payload.feedback.submittedAt) showThankYou({ ratingValue: payload.feedback.rating, already: true });
    else {
      loading.hidden = true;
      form.hidden = false;
    }
  } catch (error) {
    loading.textContent = error.message;
  }
}
