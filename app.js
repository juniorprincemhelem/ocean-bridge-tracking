const form = document.getElementById("track-form");
const input = document.getElementById("tracking-input");
const errorBox = document.getElementById("error");
const resultSection = document.getElementById("result");
const trackButton = form.querySelector("button[type=submit]");
const trackingLoading = document.getElementById("tracking-loading");

let map = null;
let markersLayer = null;

document.getElementById("year").textContent = new Date().getFullYear();

const mobileMenu = document.querySelector(".mobile-menu");
mobileMenu.querySelector("nav").addEventListener("click", (event) => {
  if (event.target.closest("a")) mobileMenu.open = false;
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = input.value.trim().toUpperCase().replace(/\s+/g, "");
  trackButton.disabled = true;
  trackingLoading.hidden = false;
  errorBox.hidden = true;
  form.setAttribute("aria-busy", "true");
  try {
    const response = await fetch(`/api/shipments/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (response.status === 404) throw new Error("We couldn't find that tracking ID. Please check it and try again.");
    if (!response.ok) throw new Error("Tracking is temporarily unavailable. Please try again.");
    const shipment = await response.json();
    showResult(id, shipment);
  } catch (error) {
    resultSection.hidden = true;
    errorBox.textContent = error instanceof TypeError
      ? "We couldn't reach the tracking service. Check your connection and try again."
      : error.message;
    errorBox.hidden = false;
  } finally {
    trackButton.disabled = false;
    trackingLoading.hidden = true;
    form.removeAttribute("aria-busy");
  }
});

function openGmailDraft(subject, body) {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: "oceanbridgeship@gmail.com",
    su: subject,
    body
  });
  window.open(`https://mail.google.com/mail/?${params}`, "_blank", "noopener,noreferrer");
}

function handleEmailForm(formId, statusId, createDraft) {
  const contactForm = document.getElementById(formId);
  const status = document.getElementById(statusId);
  contactForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const submitButton = contactForm.querySelector("button[type=submit]");
    submitButton.disabled = true;
    status.textContent = "Opening a Gmail draft...";
    try {
      openGmailDraft(...createDraft(new FormData(contactForm)));
      status.textContent = "Gmail opened with your draft. Review it and press Send to contact us.";
    } catch {
      status.textContent = "We couldn't open Gmail. Use the email icon in the footer to try again.";
    } finally {
      submitButton.disabled = false;
    }
  });
}

handleEmailForm("quote-form", "quote-status", (data) => {
  const subject = `Shipping quote request: ${data.get("origin")} to ${data.get("destination")}`;
  const body = [
    "Hello Ocean Bridge team,",
    "",
    "Please advise on a shipping quote. This is a quote request, not a confirmed booking.",
    "",
    `Name: ${data.get("name")}`,
    `Email: ${data.get("email")}`,
    `Origin: ${data.get("origin")}`,
    `Destination: ${data.get("destination")}`,
    `Cargo: ${data.get("cargo")}`,
    `Approximate weight: ${data.get("weight") || "Not provided"}`
  ].join("\n");
  return [subject, body];
});

handleEmailForm("support-form", "support-status", (data) => {
  const subject = `Shipment support: ${data.get("tracking") || data.get("topic")}`;
  const body = [
    "Hello Ocean Bridge team,",
    "",
    `Name: ${data.get("name")}`,
    `Email: ${data.get("email")}`,
    `Tracking number: ${data.get("tracking") || "Not provided"}`,
    `Topic: ${data.get("topic")}`,
    "",
    "Message:",
    data.get("message")
  ].join("\n");
  return [subject, body];
});

function showResult(id, s) {
  const current = s.history[0];
  document.body.classList.add("tracking-active");
  document.querySelector(".hero-eyebrow").textContent = "TRACK YOUR SHIPMENT";
  document.querySelector(".hero-title-home").hidden = true;
  document.querySelector(".hero-title-tracking").hidden = false;
  document.getElementById("hero-subtitle").textContent = "Enter your tracking number to see the latest updates on its journey.";

  document.getElementById("res-id").textContent = id;
  const badge = document.getElementById("res-status");
  badge.textContent = s.status;
  const normalizedStatus = s.status.toLowerCase();
  const hasArrived = normalizedStatus === "arrived at destination";
  const isDelivered = normalizedStatus === "delivered";
  badge.className = "badge" + (isDelivered ? " delivered" : hasArrived ? " arrived" : "");

  document.getElementById("res-location").textContent = current.location;
  document.getElementById("res-updated").textContent = "Last updated: " + current.time;
  document.getElementById("res-origin").textContent = s.origin;
  document.getElementById("res-dest").textContent = s.destination;
  const methodRow = document.getElementById("shipping-method-row");
  document.getElementById("res-method").textContent = s.shippingMethod || "";
  methodRow.hidden = !s.shippingMethod;

  const etaRow = document.getElementById("estimated-delivery-row");
  if (s.estimatedDelivery) {
    const etaDate = new Date(`${s.estimatedDelivery}T00:00:00`);
    document.getElementById("res-eta").textContent = Number.isNaN(etaDate.getTime())
      ? s.estimatedDelivery
      : new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(etaDate);
    etaRow.hidden = false;
  } else {
    etaRow.hidden = true;
  }

  const tl = document.getElementById("timeline");
  tl.innerHTML = "";
  const events = [...s.history].reverse();
  events.forEach((h, index) => {
    const li = document.createElement("li");
    const isLastEvent = index === events.length - 1;
    const isDestinationArrival = isLastEvent && hasArrived;
    const isCurrent = isLastEvent && !hasArrived && !isDelivered;
    li.className = isDestinationArrival ? "timeline-destination" : isCurrent ? "timeline-current" : "timeline-complete";

    const marker = document.createElement("span");
    marker.className = "timeline-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = isDestinationArrival ? "⌖" : isCurrent ? "✈" : "✓";

    const details = document.createElement("div");
    details.className = "timeline-details";
    const note = document.createElement("strong");
    note.textContent = h.note;
    const location = document.createElement("span");
    location.textContent = h.location;
    details.append(note, location);

    const time = document.createElement("time");
    time.className = "timeline-time";
    time.textContent = h.time;
    li.append(marker, details, time);
    tl.appendChild(li);
  });
  document.getElementById("progress-count").textContent = `${events.length} ${events.length === 1 ? "update" : "updates"}`;

  if (!hasArrived && !isDelivered) {
    const pending = document.createElement("li");
    pending.className = "timeline-pending";
    const marker = document.createElement("span");
    marker.className = "timeline-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = "•";
    const details = document.createElement("div");
    details.className = "timeline-details";
    const note = document.createElement("strong");
    note.textContent = "Next shipment update";
    const location = document.createElement("span");
    location.textContent = "Awaiting next scan";
    details.append(note, location);
    pending.append(marker, details);
    tl.appendChild(pending);
  }

  resultSection.hidden = false;
  drawMap(s);
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function drawMap(s) {
  if (!map) {
    map = L.map("map", { scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
  }
  markersLayer.clearLayers();

  const points = s.history.map((h) => [h.lat, h.lng]);
  const current = s.history[0];

  // Route line (oldest -> newest)
  L.polyline([...points].reverse(), { color: "#0a5cff", weight: 3, dashArray: "6 8" }).addTo(markersLayer);

  // Past stops
  s.history.slice(1).forEach((h) => {
    L.circleMarker([h.lat, h.lng], { radius: 6, color: "#0a5cff", fillColor: "#fff", fillOpacity: 1, weight: 2 })
      .bindPopup(h.location)
      .addTo(markersLayer);
  });

  // Current location
  L.marker([current.lat, current.lng]).bindPopup(`<strong>${current.location}</strong>`).addTo(markersLayer).openPopup();

  // Leaflet needs a size refresh because the container was hidden
  setTimeout(() => {
    map.invalidateSize();
    map.fitBounds(points, { padding: [50, 50], maxZoom: 6 });
  }, 50);
}
