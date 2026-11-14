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
  row.querySelector(".remove-event").addEventListener("click", () => row.remove());
  eventList.appendChild(row);
}

function renderShipment(id = "") {
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

function renderShipmentOptions(selectedId = "") {
  shipmentSelect.replaceChildren();
  for (const id of Object.keys(shipments).sort()) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    shipmentSelect.appendChild(option);
  }
  shipmentSelect.disabled = Object.keys(shipments).length === 0;
  if (selectedId && shipments[selectedId]) shipmentSelect.value = selectedId;
  else if (shipmentSelect.options.length) shipmentSelect.selectedIndex = 0;
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

shipmentSelect.addEventListener("change", () => renderShipment(shipmentSelect.value));
document.getElementById("new-shipment").addEventListener("click", () => renderShipment(""));
document.getElementById("add-event").addEventListener("click", () => addEventRow());

document.getElementById("logout").addEventListener("click", async () => {
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
  const total = receiptTotal();
  const selectedStatus = paymentStatusInput.value;
  let amountPaid = Number(amountPaidInput.value || 0);
  if (total <= 0) amountPaid = 0;
  else if (selectedStatus === "Paid") amountPaid = total;
  else if (selectedStatus === "Pending") amountPaid = 0;
  else amountPaid = Math.min(Math.max(amountPaid, 0), total);
  amountPaidInput.value = amountPaid.toFixed(2);
  return { total, amountPaid, amountPending: Math.max(total - amountPaid, 0) };
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
  const calculatedStatus = payment.total <= 0 ? "NOT PRICED" : payment.amountPending === 0 ? "PAID" : payment.amountPaid > 0 ? "PARTIALLY PAID" : "PENDING";
  document.getElementById("preview-payment-status").textContent = calculatedStatus;
  document.getElementById("preview-pending-label").textContent = payment.total <= 0 ? "ADD CHARGES" : payment.amountPending > 0 ? "DUE" : "SETTLED";
}

shipmentsTab.addEventListener("click", () => showAdminView("shipments"));
receiptTab.addEventListener("click", () => showAdminView("receipt"));
document.getElementById("add-charge").addEventListener("click", () => addReceiptCharge());
receiptForm.addEventListener("input", (event) => {
  if (event.target === amountPaidInput) {
    const total = receiptTotal();
    const amountPaid = Number(amountPaidInput.value || 0);
    paymentStatusInput.value = amountPaid <= 0 ? "Pending" : amountPaid >= total ? "Paid" : "Partially Paid";
  }
  updateReceiptPreview();
});
receiptForm.addEventListener("change", (event) => {
  if (event.target === paymentStatusInput) {
    if (paymentStatusInput.value === "Partially Paid" && Number(amountPaidInput.value) === 0 && receiptTotal() > 0) {
      amountPaidInput.value = (receiptTotal() / 2).toFixed(2);
    }
  } else if (event.target === amountPaidInput) {
    const total = receiptTotal();
    const paid = Number(amountPaidInput.value || 0);
    paymentStatusInput.value = paid <= 0 ? "Pending" : paid >= total ? "Paid" : "Partially Paid";
  }
  updateReceiptPreview();
});

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
