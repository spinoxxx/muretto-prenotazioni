async function api(path) {
  const response = await fetch(path, { headers: { "content-type": "application/json" } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Operazione non riuscita");
  return payload;
}

function setText(selector, value) {
  if (!value) return;
  document.querySelectorAll(selector).forEach((element) => {
    element.textContent = value;
  });
}

try {
  const payload = await api("/api/config");
  const brand = payload.brand || {};
  const privacy = brand.privacy || {};
  document.title = brand.name ? `Privacy ${brand.name}` : document.title;
  setText("[data-brand-name]", brand.name);
  setText("[data-brand-category]", brand.category);
  setText("[data-privacy-controller]", privacy.controller);
  setText("[data-privacy-contact]", privacy.contact);
  setText("[data-privacy-retention]", privacy.retention);
  setText("[data-privacy-version]", privacy.version);

  if (brand.colors?.accent) document.documentElement.style.setProperty("--accent", brand.colors.accent);
  if (brand.colors?.accentDark) document.documentElement.style.setProperty("--accent-dark", brand.colors.accentDark);
  if (brand.colors?.warm) document.documentElement.style.setProperty("--warm", brand.colors.warm);
} catch {
  // Keep the static privacy text visible if configuration cannot be loaded.
}
