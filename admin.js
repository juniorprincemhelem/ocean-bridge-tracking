const loginPanel = document.getElementById("login-panel");
const loginForm = document.getElementById("login-form");
const editor = document.getElementById("editor");
const shipmentForm = document.getElementById("shipment-form");
const shipmentSelect = document.getElementById("shipment-select");
const shipmentId = document.getElementById("shipment-id");
const statusInput = document.getElementById("shipment-status");
const originInput = document.getElementById("shipment-origin");
const destinationInput = document.getElementById("shipment-destination");
const methodInput = document.getElementById("shipment-method");
const etaInput = document.getElementById("shipment-eta");
const eventList = document.getElementById("event-list");
const message = document.getElementById("admin-message");
const deleteButton = document.getElementById("delete-shipment");
let shipments = {};
let creating = false;
let shipmentSearchTerm = "";
let shipmentStatusFilter = "";
let activeShipmentId = "";
let shipmentDirty = false;
function updateShipmentSaveState() {
  const state = document.getElementById("shipment-save-state");
  if (!state) return;
  state.textContent = shipmentDirty ? "Unsaved changes" : "All changes saved";
  state.classList.toggle("is-dirty", shipmentDirty);
}

function confirmDiscardShipmentChanges() {
  return !shipmentDirty || window.confirm("You have unsaved shipment changes. Leave this record without saving?");
}

function restoreActiveShipmentSelection() {
  document.getElementById("shipment-search").value = activeShipmentId;
  shipmentSearchTerm = activeShipmentId.toLowerCase();
  renderShipmentOptions(activeShipmentId);
  shipmentSelect.value = activeShipmentId;
  document.getElementById("shipment-search-results").hidden = true;
}

function showMessage(text, kind = "error") {
  message.textContent = text;
  message.dataset.kind = kind;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function addEventRow(event = {}) {
  const row = document.createElement("fieldset");
  row.className = "event-row";
  row.innerHTML = `
    <div class="event-row-head"><legend>Tracking event</legend><button class="button-danger remove-event" type="button">Remove</button></div>
    <div class="event-fields">
      <label>Location<input data-field="location" required maxlength="160" value=""></label>
      <label>Latitude<input data-field="lat" type="number" min="-90" max="90" step="any" required></label>
      <label>Longitude<input data-field="lng" type="number" min="-180" max="180" step="any" required></label>
      <label>Time<input data-field="time" required maxlength="80" value=""></label>
      <label class="event-note">Event note<input data-field="note" required maxlength="240" value=""></label>
    </div>`;
  for (const [field, value] of Object.entries(event)) {
    const input = row.querySelector(`[data-field="${field}"]`);
    if (input) input.value = String(value);
  }
  row.querySelector(".remove-event").addEventListener("click", () => {
    row.remove();
    shipmentDirty = true;
    updateShipmentSaveState();
  });
  eventList.appendChild(row);
}

function renderShipment(id = "") {
  activeShipmentId = id;
  shipmentDirty = false;
  updateShipmentSaveState();
  const shipment = shipments[id];
  creating = !shipment;
  shipmentForm.hidden = false;
  shipmentId.disabled = !creating;
  shipmentId.value = shipment ? id : "";
  statusInput.value = shipment?.status || "In Transit";
  originInput.value = shipment?.origin || "";
  destinationInput.value = shipment?.destination || "";
  methodInput.value = shipment?.shippingMethod || "";
  etaInput.value = shipment?.estimatedDelivery || "";
  eventList.replaceChildren();
  (shipment?.history || [{ location: "", lat: "", lng: "", time: "", note: "" }]).forEach(addEventRow);
  deleteButton.hidden = creating;
}

function renderShipmentSearchResults() {
  const results = document.getElementById("shipment-search-results");
  results.replaceChildren();
  const query = shipmentSearchTerm;
  if (!query) {
    results.hidden = true;
    return;
  }

  const matches = Object.entries(shipments)
    .filter(([id, shipment]) => !shipmentStatusFilter || String(shipment.status || "").toLowerCase() === shipmentStatusFilter)
    .filter(([id, shipment]) => [id, shipment.origin, shipment.destination, shipment.status].join(" ").toLowerCase().includes(query))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 8);

  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "shipment-search-empty";
    empty.textContent = "No matching shipments found.";
    results.appendChild(empty);
  } else {
    for (const [id, shipment] of matches) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "shipment-search-result";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(id === activeShipmentId));
      const tracking = document.createElement("strong");
      tracking.textContent = id;
      const route = document.createElement("span");
      route.textContent = [shipment.origin, shipment.destination].filter(Boolean).join(" → ") || "Route not provided";
      const status = document.createElement("small");
      status.textContent = shipment.status || "Status unavailable";
      button.append(tracking, route, status);
      button.addEventListener("click", () => {
        if (!confirmDiscardShipmentChanges()) {
          restoreActiveShipmentSelection();
          return;
        }
        shipmentSearchTerm = id.toLowerCase();
        document.getElementById("shipment-search").value = id;
        renderShipmentOptions(id);
        shipmentSelect.value = id;
        renderShipment(id);
        results.hidden = true;
        showMessage(`Loaded shipment ${id}.`, "success");
      });
      results.appendChild(button);
    }
  }
  results.hidden = false;
}

function updateShipmentOverview() {
  const records = Object.values(shipments);
  const count = (status) => records.filter((shipment) => String(shipment.status || "").toLowerCase() === status).length;
  document.getElementById("overview-total").textContent = String(records.length);
  document.getElementById("overview-transit").textContent = String(count("in transit"));
  document.getElementById("overview-arrived").textContent = String(count("arrived at destination"));
  document.getElementById("overview-delivered").textContent = String(count("delivered"));
}

function renderShipmentOptions(selectedId = "") {
  shipmentSelect.replaceChildren();
  const entries = Object.entries(shipments).sort(([a], [b]) => a.localeCompare(b));
  for (const [id, shipment] of entries) {
    const searchable = [id, shipment.origin, shipment.destination, shipment.status].join(" ").toLowerCase();
    if (shipmentStatusFilter && String(shipment.status || "").toLowerCase() !== shipmentStatusFilter) continue;
    if (shipmentSearchTerm && !searchable.includes(shipmentSearchTerm)) continue;
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    shipmentSelect.appendChild(option);
  }
  shipmentSelect.disabled = shipmentSelect.options.length === 0;
  const preferredId = selectedId || activeShipmentId;
  if (preferredId && [...shipmentSelect.options].some((option) => option.value === preferredId)) shipmentSelect.value = preferredId;
  else if (shipmentSelect.options.length) shipmentSelect.selectedIndex = 0;
  else {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No matching shipments";
    shipmentSelect.appendChild(option);
  }
  updateShipmentOverview();
  document.querySelectorAll("[data-status-filter]").forEach((card) => {
    card.setAttribute("aria-pressed", String(card.dataset.statusFilter === shipmentStatusFilter));
  });
}

async function loadShipments(selectedId = "") {
  shipments = await api("/api/admin/shipments");
  renderShipmentOptions(selectedId);
  if (Object.keys(shipments).length) renderShipment(shipmentSelect.value);
  else renderShipment("");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: document.getElementById("admin-password").value })
    });
    await loadShipments();
    loginPanel.hidden = true;
    editor.hidden = false;
    showMessage("Signed in. Shipment changes are saved to the server.", "success");
  } catch (error) {
    showMessage(error.message);
  } finally {
    button.disabled = false;
  }
});

shipmentForm.addEventListener("input", () => { shipmentDirty = true; updateShipmentSaveState(); });
shipmentForm.addEventListener("change", () => { shipmentDirty = true; updateShipmentSaveState(); });

shipmentSelect.addEventListener("change", () => {
  if (shipmentSelect.value) {
    if (!confirmDiscardShipmentChanges()) {
      restoreActiveShipmentSelection();
      return;
    }
    renderShipment(shipmentSelect.value);
    document.getElementById("shipment-search").value = shipmentSelect.value;
    shipmentSearchTerm = shipmentSelect.value.toLowerCase();
    document.getElementById("shipment-search-results").hidden = true;
  }
});
document.getElementById("shipment-search").addEventListener("input", (event) => {
  shipmentSearchTerm = event.target.value.trim().toLowerCase();
  renderShipmentOptions(activeShipmentId);
  renderShipmentSearchResults();
});

document.querySelectorAll("[data-status-filter]").forEach((card) => {
  card.addEventListener("click", () => {
    if (!confirmDiscardShipmentChanges()) return;
    shipmentStatusFilter = card.dataset.statusFilter;
    shipmentSearchTerm = "";
    document.getElementById("shipment-search").value = "";
    document.getElementById("shipment-search-results").hidden = true;
    renderShipmentOptions("");
    const firstMatch = shipmentSelect.options.length && shipmentSelect.value ? shipmentSelect.value : "";
    if (firstMatch) renderShipment(firstMatch);
    else shipmentForm.hidden = true;
    const label = card.querySelector("span").textContent.toLowerCase();
    showMessage(firstMatch ? "Showing " + label + " shipments." : "No " + label + " records found.", "success");
  });
});
document.getElementById("new-shipment").addEventListener("click", () => {
  if (!confirmDiscardShipmentChanges()) return;
  shipmentStatusFilter = "";
  renderShipment("");
  document.getElementById("shipment-search").value = "";
  shipmentSearchTerm = "";
  document.getElementById("shipment-search-results").hidden = true;
  renderShipmentOptions("");
});
document.getElementById("add-event").addEventListener("click", () => {
  addEventRow();
  shipmentDirty = true;
  updateShipmentSaveState();
});

document.getElementById("logout").addEventListener("click", async () => {
  if (!confirmDiscardShipmentChanges()) return;
  try {
    await api("/api/admin/logout", { method: "POST", body: "{}" });
  } finally {
    editor.hidden = true;
    shipmentForm.hidden = true;
    loginPanel.hidden = false;
    loginForm.reset();
    showMessage("Signed out.", "success");
  }
});

shipmentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = (shipmentId.value || "").trim().toUpperCase().replace(/\s+/g, "");
  const history = [...eventList.querySelectorAll(".event-row")].map((row) => {
    const value = (field) => row.querySelector(`[data-field="${field}"]`).value.trim();
    return { location: value("location"), lat: Number(value("lat")), lng: Number(value("lng")), time: value("time"), note: value("note") };
  });
  try {
    const result = await api(`/api/admin/shipments/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({
        status: statusInput.value,
        origin: originInput.value.trim(),
        destination: destinationInput.value.trim(),
        shippingMethod: methodInput.value.trim(),
        estimatedDelivery: etaInput.value,
        history
      })
    });
    await loadShipments(result.id);
    showMessage(`Saved ${result.id}.`, "success");
  } catch (error) {
    showMessage(error.message);
  }
});

deleteButton.addEventListener("click", async () => {
  const id = shipmentId.value;
  if (!id || !window.confirm(`Delete shipment ${id}? This cannot be undone.`)) return;
  try {
    await api(`/api/admin/shipments/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadShipments();
    showMessage(`Deleted ${id}.`, "success");
  } catch (error) {
    showMessage(error.message);
  }
});

async function initialize() {
  try {
    const status = await api("/api/admin/status");
    if (!status.configured) {
      loginForm.querySelector("button[type=submit]").disabled = true;
      showMessage("Admin access is not configured. Set ADMIN_PASSWORD before starting the server.");
    }
  } catch (error) {
    showMessage(`${error.message} Open this page through the Ocean Bridge server.`);
  }
}

initialize();

const shipmentsTab = document.getElementById("shipments-tab");
const receiptTab = document.getElementById("receipt-tab");
const shipmentsView = document.getElementById("shipments-view");
const receiptView = document.getElementById("receipt-view");
const receiptForm = document.getElementById("receipt-form");
const chargeList = document.getElementById("receipt-charge-list");
const currencyInput = document.getElementById("receipt-currency");
const paymentStatusInput = document.getElementById("receipt-payment-status");
const amountPaidInput = document.getElementById("receipt-paid");
const amountPendingInput = document.getElementById("receipt-pending");

function showAdminView(view) {
  const isReceiptView = view === "receipt";
  shipmentsView.hidden = isReceiptView;
  receiptView.hidden = !isReceiptView;
  shipmentsTab.classList.toggle("is-active", !isReceiptView);
  receiptTab.classList.toggle("is-active", isReceiptView);
  shipmentsTab.setAttribute("aria-selected", String(!isReceiptView));
  receiptTab.setAttribute("aria-selected", String(isReceiptView));
  if (isReceiptView) updateReceiptPreview();
}

function localDateValue() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function newReceiptNumber() {
  const datePart = localDateValue().replaceAll("-", "");
  const randomPart = crypto.randomUUID().slice(0, 6).toUpperCase();
  return `OB-${datePart}-${randomPart}`;
}

function addReceiptCharge(name = "", amount = "") {
  const row = document.createElement("div");
  row.className = "receipt-charge-editor";
  row.innerHTML = `
    <label>Charge description<input class="charge-name" maxlength="80" value=""></label>
    <label>Amount<input class="charge-amount" type="number" min="0" step="0.01" value=""></label>
    <button class="button-danger remove-charge" type="button" aria-label="Remove charge">Remove</button>`;
  row.querySelector(".charge-name").value = name;
  row.querySelector(".charge-amount").value = amount;
  row.addEventListener("input", updateReceiptPreview);
  row.querySelector(".remove-charge").addEventListener("click", () => {
    row.remove();
    updateReceiptPreview();
  });
  chargeList.appendChild(row);
  updateReceiptPreview();
}

function receiptCharges() {
  return [...chargeList.querySelectorAll(".receipt-charge-editor")]
    .map((row) => ({
      name: row.querySelector(".charge-name").value.trim(),
      amount: Number(row.querySelector(".charge-amount").value || 0)
    }))
    .filter((charge) => charge.name || charge.amount > 0);
}

function receiptTotal() {
  return receiptCharges().reduce((total, charge) => total + charge.amount, 0);
}

function updatePaymentValues() {
  return {
    total: receiptTotal(),
    amountPaid: Number(amountPaidInput.value || 0),
    amountPending: Number(amountPendingInput.value || 0)
  };
}

function currencyText(amount) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyInput.value,
    minimumFractionDigits: 2
  }).format(amount);
}

function setPreviewText(id, value, fallback = "Not provided") {
  document.getElementById(id).textContent = value || fallback;
}

function updateReceiptPreview() {
  const formData = new FormData(receiptForm);
  const payment = updatePaymentValues();
  const receiptDate = formData.get("receiptDate");
  const displayDate = receiptDate
    ? new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${receiptDate}T00:00:00Z`))
    : "Not provided";

  setPreviewText("preview-receipt-number", formData.get("receiptNumber"));
  setPreviewText("preview-receipt-date", displayDate);
  setPreviewText("preview-tracking", formData.get("trackingNumber"));
  setPreviewText("preview-shipper", formData.get("shipper"));
  setPreviewText("preview-consignee", formData.get("consignee"));
  setPreviewText("preview-origin", formData.get("originAddress"));
  setPreviewText("preview-destination", formData.get("destinationAddress"));
  setPreviewText("preview-contents", formData.get("contents"));
  setPreviewText("preview-service", formData.get("service"));
  setPreviewText("preview-pieces", formData.get("pieces"), "0");
  document.getElementById("preview-piece-label").textContent = Number(formData.get("pieces")) === 1 ? "piece" : "pieces";
  setPreviewText("preview-weight", formData.get("weight"));
  setPreviewText("preview-estimate", formData.get("estimatedDelivery"));
  setPreviewText("preview-status", formData.get("shipmentStatus"));
  setPreviewText("preview-contact", formData.get("customerService"));

  const chargePreview = document.getElementById("receipt-charge-preview");
  chargePreview.replaceChildren();
  for (const charge of receiptCharges()) {
    const row = document.createElement("div");
    row.className = "receipt-charge-line";
    const label = document.createElement("span");
    label.textContent = charge.name;
    const amount = document.createElement("strong");
    amount.textContent = currencyText(charge.amount);
    row.append(label, amount);
    chargePreview.appendChild(row);
  }
  if (!chargePreview.childElementCount) {
    const emptyLine = document.createElement("div");
    emptyLine.className = "receipt-charge-line receipt-empty-charge";
    emptyLine.textContent = "Add charge items to calculate the total.";
    chargePreview.appendChild(emptyLine);
  }

  document.getElementById("preview-total").textContent = currencyText(payment.total);
  document.getElementById("preview-paid").textContent = currencyText(payment.amountPaid);
  document.getElementById("preview-pending").textContent = currencyText(payment.amountPending);
  document.getElementById("preview-payment-status").textContent = paymentStatusInput.value.toUpperCase();
  document.getElementById("preview-pending-label").textContent = payment.total <= 0 ? "" : payment.amountPending > 0 ? "DUE" : "SETTLED";
}

shipmentsTab.addEventListener("click", () => showAdminView("shipments"));
receiptTab.addEventListener("click", () => showAdminView("receipt"));
document.getElementById("add-charge").addEventListener("click", () => addReceiptCharge());
receiptForm.addEventListener("input", updateReceiptPreview);
receiptForm.addEventListener("change", updateReceiptPreview);

receiptForm.addEventListener("submit", (event) => {
  event.preventDefault();
  updateReceiptPreview();
  document.getElementById("receipt-form-status").textContent = "Receipt preview updated. Choose Print / Save PDF to export it.";
});

document.getElementById("print-receipt").addEventListener("click", () => {
  if (!receiptForm.reportValidity()) return;
  if (receiptTotal() <= 0) {
    document.getElementById("receipt-form-status").textContent = "Add at least one charge with an amount greater than zero before printing.";
    return;
  }
  updateReceiptPreview();
  window.print();
});

function initializeReceipt() {
  document.getElementById("receipt-number").value = newReceiptNumber();
  document.getElementById("receipt-date").value = localDateValue();
  ["Transportation charge", "Fuel surcharge", "Handling & packaging", "Documentation fee"].forEach((name) => addReceiptCharge(name));
  updateReceiptPreview();
}

initializeReceipt();
