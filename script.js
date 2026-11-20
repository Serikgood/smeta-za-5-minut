"use strict";

const items = document.querySelector("#items");
const template = document.querySelector("#item-template");
const totalOutput = document.querySelector("#total");
const addButton = document.querySelector("#add-item");
const discountInput = document.querySelector("#discount-rate");
const vatInput = document.querySelector("#vat-rate");
const currencyInput = document.querySelector("#currency");
const moneyFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const draftKey = "smeta-draft-v1";
const fieldIds = ["sender", "recipient", "estimate-number", "estimate-date", "discount-rate", "vat-rate", "currency", "comment"];
const rowFields = ["name", "quantity", "unit", "price"];
let isInitializing = true;
let copyStatusTimer;
const duplicateDialog = document.querySelector("#duplicate-dialog");
const checkedItems = new WeakMap();
const newItems = new WeakSet();
const duplicateHighlightTimers = new WeakMap();
let pendingDuplicate = null;
const catalogKey = "smeta-catalog-v1";
let catalog = [];
let currentCatalogId = null;
let catalogUnavailable = false;

// Принимаем десятичную запятую и пробелы между группами тысяч.
function parseNumber(value) {
  const normalized = String(value).trim().replace(/[\u00a0\u202f]/g, " ");
  if (!/^(?:\d+|\d{1,3}(?: \d{3})+)(?:[.,]\d+)?$/.test(normalized)) return 0;
  const number = Number(normalized.replace(/ /g, "").replace(",", "."));
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function formatMoney(value) {
  const safeValue = Number.isFinite(value) && value >= 0 ? value : 0;
  return moneyFormatter.format(safeValue).replace(/[\u00a0\u202f]/g, " ") + " " + currencyInput.value;
}

function roundAmount(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function showSummaryAmount(outputId, rowId, amount) {
  document.querySelector(outputId).textContent = formatMoney(amount);
  document.querySelector(rowId).hidden = amount === 0;
}

function recalculate() {
  let subtotal = 0;
  for (const row of items.rows) {
    const quantity = parseNumber(row.querySelector('[data-field="quantity"]').value);
    const price = parseNumber(row.querySelector('[data-field="price"]').value);
    const product = quantity * price;
    const amount = roundAmount(product);
    row.querySelector('[data-field="amount"]').textContent = formatMoney(amount);
    subtotal = roundAmount(subtotal + amount);
  }
  const discountRate = Math.min(100, parseNumber(discountInput.value));
  const discount = roundAmount(subtotal * (discountRate / 100));
  const discounted = roundAmount(subtotal - discount);
  const vat = roundAmount(discounted * (parseNumber(vatInput.value) / 100));
  document.querySelector("#subtotal").textContent = formatMoney(subtotal);
  showSummaryAmount("#discount-amount", "#discount-row", discount);
  showSummaryAmount("#discounted-amount", "#discounted-row", discounted);
  showSummaryAmount("#vat-amount", "#vat-row", vat);
  totalOutput.textContent = formatMoney(roundAmount(discounted + vat));
}

function updateCurrency() {
  const priceLabel = "Цена, " + currencyInput.value;
  document.querySelector("#price-heading").textContent = priceLabel;
  document.querySelector("#currency-hint").textContent = "Цены в " + currencyInput.value;
  for (const row of items.rows) {
    const priceInput = row.querySelector('[data-field="price"]');
    priceInput.setAttribute("aria-label", priceLabel);
    priceInput.closest("td").dataset.label = priceLabel;
  }
  recalculate();
}

function addItem(focus = true, values = null) {
  const row = template.content.firstElementChild.cloneNode(true);
  if (values) {
    for (const field of rowFields) row.querySelector(`[data-field="${field}"]`).value = values[field];
  }
  items.append(row);
  checkedItems.set(row, readItem(row));
  if (!values) newItems.add(row);
  if (focus) row.querySelector('[data-field="name"]').focus();
  updateCurrency();
  saveDraft();
}

addButton.addEventListener("click", requestAddItem);
discountInput.addEventListener("input", recalculate);
vatInput.addEventListener("input", recalculate);
currencyInput.addEventListener("change", updateCurrency);
items.addEventListener("input", recalculate);
items.addEventListener("change", event => {
  const row = event.target.closest("tr");
  if (row) checkDuplicate(row);
});
items.addEventListener("focusout", event => {
  const row = event.target.closest("tr");
  if (!row || !event.relatedTarget || row.contains(event.relatedTarget)) return;
  if (!checkDuplicate(row) && itemKey(readItem(row))) newItems.delete(row);
});
items.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-button");
  if (!button) return;
  const row = button.closest("tr");
  const nextRow = row.nextElementSibling || row.previousElementSibling;
  row.remove();
  recalculate();
  saveDraft();
  if (nextRow) nextRow.querySelector('[data-field="name"]').focus();
  else addButton.focus();
});

items.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing || event.repeat) return;
  // Не перехватываем Enter у кнопки удаления и выбора единицы.
  if (!event.target.matches("input")) return;
  if (event.target.closest("tr") !== items.lastElementChild) return;
  event.preventDefault();
  requestAddItem();
});

function readItem(row) {
  return Object.fromEntries(rowFields.map(field => [field, row.querySelector(`[data-field="${field}"]`).value]));
}

function itemKey(values) {
  const name = values.name.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
  const validNumber = value => /^(?:\d+|\d{1,3}(?: \d{3})+)(?:[.,]\d+)?$/.test(value.trim().replace(/[\u00a0\u202f]/g, " "));
  // Пустые и ещё не заполненные строки не требуют подтверждения.
  if (!name || !validNumber(values.quantity) || !validNumber(values.price)) return null;
  return JSON.stringify([name, parseNumber(values.quantity), values.unit, parseNumber(values.price)]);
}

function checkDuplicate(row) {
  if (isInitializing || pendingDuplicate) return Boolean(pendingDuplicate);
  const values = readItem(row);
  const previous = checkedItems.get(row);
  const key = itemKey(values);
  const match = key && key !== (previous ? itemKey(previous) : null)
    ? Array.from(items.rows).find(other => other !== row && itemKey(readItem(other)) === key)
    : null;
  if (!match) {
    checkedItems.set(row, values);
    return false;
  }
  pendingDuplicate = { row, previous, isNew: newItems.has(row), addNext: false };
  window.clearTimeout(duplicateHighlightTimers.get(match));
  match.classList.add("duplicate-match");
  duplicateHighlightTimers.set(match, window.setTimeout(() => match.classList.remove("duplicate-match"), 3000));
  duplicateDialog.showModal();
  document.querySelector("#duplicate-cancel").focus();
  saveDraft();
  return true;
}

function requestAddItem() {
  if (pendingDuplicate) {
    pendingDuplicate.addNext = true;
    return;
  }
  if (items.lastElementChild && checkDuplicate(items.lastElementChild)) {
    pendingDuplicate.addNext = true;
    return;
  }
  if (items.lastElementChild) newItems.delete(items.lastElementChild);
  addItem();
}

function resolveDuplicate(accept) {
  if (!pendingDuplicate) return;
  const { row, previous, isNew, addNext } = pendingDuplicate;
  pendingDuplicate = null;
  duplicateDialog.close();
  if (accept) {
    checkedItems.set(row, readItem(row));
    newItems.delete(row);
  } else if (isNew) {
    row.remove();
  } else {
    for (const field of rowFields) row.querySelector(`[data-field="${field}"]`).value = previous[field];
  }
  recalculate();
  saveDraft();
  if (accept && addNext) addItem();
  else if (row.isConnected) row.querySelector('[data-field="name"]').focus();
  else addButton.focus();
}

document.querySelector("#duplicate-accept").addEventListener("click", () => resolveDuplicate(true));
document.querySelector("#duplicate-cancel").addEventListener("click", () => resolveDuplicate(false));
duplicateDialog.addEventListener("cancel", event => {
  event.preventDefault();
  resolveDuplicate(false);
});

function getEstimateTitle() {
  const number = document.querySelector("#estimate-number").value.trim() || "—";
  const date = document.querySelector("#estimate-date").value;
  const formattedDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date.split("-").reverse().join(".")
    : "—";
  return `Смета № ${number} от ${formattedDate}`;
}

// Текстовые копии не обрезаются шириной полей и сохраняют переносы при печати.
function preparePrint() {
  recalculate();
  document.querySelector("#print-title").textContent = getEstimateTitle();

  const controls = document.querySelectorAll(".details-grid input, #items input, #items select, #comment");
  for (const control of controls) {
    let text = control.nextElementSibling;
    if (!text || !text.classList.contains("print-value")) {
      text = document.createElement("span");
      text.className = "print-value";
      text.setAttribute("aria-hidden", "true");
      control.after(text);
    }
    text.textContent = control.value;
  }
}

document.querySelector("#save-pdf").addEventListener("click", () => {
  preparePrint();
  window.print();
});
window.addEventListener("beforeprint", preparePrint);

function todayValue() {
  const today = new Date();
  return [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
}

function readDraft() {
  const fields = Object.fromEntries(fieldIds.map(id => [id, document.getElementById(id).value]));
  const positions = Array.from(items.rows).flatMap(row => {
    if (pendingDuplicate && pendingDuplicate.row === row) {
      return pendingDuplicate.isNew ? [] : [pendingDuplicate.previous];
    }
    return [readItem(row)];
  });
  return { version: 1, fields, positions, catalogId: currentCatalogId };
}

function saveDraft() {
  if (isInitializing) return;
  const status = document.querySelector("#draft-status");
  try {
    window.localStorage.setItem(draftKey, JSON.stringify(readDraft()));
    status.textContent = "Черновик сохраняется в этом браузере. Данные никуда не отправляются.";
  } catch {
    status.textContent = "Не удалось сохранить черновик: хранилище браузера недоступно или заполнено. Сохраните смету в PDF или скопируйте текст.";
  }
}

function restoreDraft() {
  try {
    const saved = window.localStorage.getItem(draftKey);
    if (saved === null) return false;
    const draft = JSON.parse(saved);
    if (!isValidEstimate(draft)) {
      throw new Error("Неверный формат черновика");
    }
    for (const id of fieldIds) document.getElementById(id).value = draft.fields[id];
    currentCatalogId = catalog.some(record => record.id === draft.catalogId) ? draft.catalogId : null;
    for (const position of draft.positions) addItem(false, position);
    updateCurrency();
    return true;
  } catch {
    document.querySelector("#draft-status").textContent = "Не удалось восстановить черновик. Хранилище недоступно или сохранённые данные повреждены.";
    return false;
  }
}

function resetEstimate(number) {
  currentCatalogId = null;
  document.querySelector("#catalog-save-status").textContent = "";
  for (const id of fieldIds) document.getElementById(id).value = "";
  document.querySelector("#estimate-number").value = number;
  document.querySelector("#estimate-date").value = todayValue();
  discountInput.value = "0";
  vatInput.value = "0";
  currencyInput.value = "₸";
  items.replaceChildren();
  addItem(false);
}

document.querySelector("#new-estimate").addEventListener("click", () => {
  if (!window.confirm("Создать новую смету? Текущий черновик будет заменён пустой сметой.")) return;
  const current = document.querySelector("#estimate-number").value.trim();
  // Сохраняем префикс и ведущие нули, например КП-009 → КП-010.
  const nextNumber = /\d+$/.test(current)
    ? current.replace(/\d+$/, digits => String(BigInt(digits) + 1n).padStart(digits.length, "0"))
    : "1";
  resetEstimate(nextNumber);
  clearCopyFeedback();
  document.querySelector("#sender").focus();
});

function buildShareText() {
  recalculate();
  const lines = [getEstimateTitle()];
  for (const [id, label] of [["sender", "От кого"], ["recipient", "Для кого"]]) {
    const value = document.getElementById(id).value.trim();
    if (value) lines.push(`${label}: ${value}`);
  }
  lines.push("");
  for (const row of items.rows) {
    const value = field => row.querySelector(`[data-field="${field}"]`).value;
    const name = value("name").trim() || "Без наименования";
    const quantity = String(parseNumber(value("quantity"))).replace(".", ",");
    const price = formatMoney(parseNumber(value("price")));
    const amount = row.querySelector('[data-field="amount"]').textContent;
    lines.push(`• ${name} — ${quantity} ${value("unit")} × ${price} = ${amount}`);
  }
  lines.push("", "Сумма: " + document.querySelector("#subtotal").textContent);
  for (const [rowId, outputId, label] of [
    ["#discount-row", "#discount-amount", "Скидка"],
    ["#discounted-row", "#discounted-amount", "Сумма со скидкой"],
    ["#vat-row", "#vat-amount", "НДС"],
  ]) {
    if (!document.querySelector(rowId).hidden) lines.push(label + ": " + document.querySelector(outputId).textContent);
  }
  lines.push("Итого к оплате: " + totalOutput.textContent);
  const comment = document.querySelector("#comment").value.trim();
  if (comment) lines.push("", "Комментарий: " + comment);
  return lines.join("\n");
}

function clearCopyFeedback() {
  window.clearTimeout(copyStatusTimer);
  document.querySelector("#copy-status").textContent = "";
  document.querySelector("#copy-fallback").hidden = true;
  document.querySelector("#share-text").value = "";
}

document.querySelector("#copy-whatsapp").addEventListener("click", async () => {
  clearCopyFeedback();
  const text = buildShareText();
  try {
    await navigator.clipboard.writeText(text);
    document.querySelector("#copy-status").textContent = "Скопировано ✓";
    copyStatusTimer = window.setTimeout(() => {
      document.querySelector("#copy-status").textContent = "";
    }, 2000);
  } catch {
    document.querySelector("#copy-fallback").hidden = false;
    const field = document.querySelector("#share-text");
    field.value = text;
    field.focus();
    field.select();
  }
});

// Делегирование охватывает реквизиты, комментарий и динамические строки.
for (const eventName of ["input", "change"]) {
  document.querySelector("#estimate-editor").addEventListener(eventName, event => {
    if (event.target.matches("input, select, textarea") && event.target.id !== "share-text") saveDraft();
  });
}

function isValidEstimate(draft) {
  return Boolean(draft && draft.version === 1 && draft.fields && Array.isArray(draft.positions)
    && fieldIds.every(id => typeof draft.fields[id] === "string")
    && ["₸", "₽", "$", "€"].includes(draft.fields.currency)
    && draft.positions.every(row => row && rowFields.every(field => typeof row[field] === "string")
      && ["шт", "час", "услуга", "м"].includes(row.unit)));
}

function loadCatalog() {
  catalogUnavailable = true;
  const raw = window.localStorage.getItem(catalogKey);
  if (raw === null) { catalog = []; catalogUnavailable = false; return; }
  const data = JSON.parse(raw);
  if (!data || data.version !== 1 || !Array.isArray(data.records)
    || !data.records.every(record => record && typeof record.id === "string" && record.id
      && Number.isSafeInteger(record.createdAt) && Number.isSafeInteger(record.updatedAt)
      && isValidEstimate(record.draft))
    || new Set(data.records.map(record => record.id)).size !== data.records.length) {
    throw new Error("Повреждённый каталог");
  }
  catalog = data.records;
  catalogUnavailable = false;
}

function estimateTotal(draft) {
  let subtotal = 0;
  for (const row of draft.positions) subtotal = roundAmount(subtotal + roundAmount(parseNumber(row.quantity) * parseNumber(row.price)));
  const discount = roundAmount(subtotal * (Math.min(100, parseNumber(draft.fields["discount-rate"])) / 100));
  const discounted = roundAmount(subtotal - discount);
  return roundAmount(discounted + roundAmount(discounted * (parseNumber(draft.fields["vat-rate"]) / 100)));
}

document.querySelector("#save-estimate").addEventListener("click", () => {
  const status = document.querySelector("#catalog-save-status");
  if (pendingDuplicate) return;
  // Проверяем также строку, из которой ещё не ушёл фокус (например, после Enter).
  for (const row of items.rows) if (checkDuplicate(row)) return;
  try {
    loadCatalog();
    const draft = readDraft();
    delete draft.catalogId;
    const existing = catalog.find(record => record.id === currentCatalogId);
    const now = catalog.reduce((time, record) => Math.max(time, record.updatedAt + 1), Date.now());
    const id = existing ? existing.id : "estimate-" + now;
    const record = { id, createdAt: existing ? existing.createdAt : now, updatedAt: now, draft };
    const next = existing ? catalog.map(item => item.id === id ? record : item) : [...catalog, record];
    window.localStorage.setItem(catalogKey, JSON.stringify({ version: 1, records: next }));
    catalog = next;
    currentCatalogId = id;
    saveDraft();
    status.textContent = existing ? "Смета обновлена в каталоге." : "Смета сохранена в каталоге.";
  } catch {
    status.textContent = "Не удалось сохранить смету в каталог: хранилище недоступно, заполнено или каталог повреждён.";
  }
});

function filteredEstimates() {
  const normalize = value => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
  const client = normalize(document.querySelector("#catalog-client").value);
  const number = normalize(document.querySelector("#catalog-number").value);
  const date = document.querySelector("#catalog-date").value;
  const from = document.querySelector("#catalog-from").value;
  const to = document.querySelector("#catalog-to").value;
  const filtered = catalog.filter(record => {
    const fields = record.draft.fields;
    const recordDate = fields["estimate-date"];
    return normalize(fields.recipient).includes(client) && normalize(fields["estimate-number"]).includes(number)
      && (!date || recordDate === date) && (!from || recordDate >= from) && (!to || (recordDate && recordDate <= to));
  });
  const sort = document.querySelector("#catalog-sort").value;
  const collator = new Intl.Collator("ru-RU", { numeric: true, sensitivity: "base" });
  return filtered.sort((a, b) => {
    let order = 0;
    if (sort.startsWith("date-")) order = a.draft.fields["estimate-date"].localeCompare(b.draft.fields["estimate-date"]);
    if (sort.startsWith("number-")) order = collator.compare(a.draft.fields["estimate-number"], b.draft.fields["estimate-number"]);
    if (sort.startsWith("total-")) order = estimateTotal(a.draft) - estimateTotal(b.draft);
    if (sort.endsWith("-desc")) order = -order;
    return order || b.createdAt - a.createdAt;
  });
}

function renderCatalog() {
  if (catalogUnavailable) {
    document.querySelector("#catalog-items").replaceChildren();
    document.querySelector("#catalog-empty").hidden = true;
    document.querySelector("#catalog-count").textContent = "";
    document.querySelector("#catalog-status").textContent = "Не удалось загрузить каталог: хранилище недоступно или данные повреждены.";
    return;
  }
  const rows = filteredEstimates();
  const body = document.querySelector("#catalog-items");
  body.replaceChildren();
  for (const record of rows) {
    const row = document.createElement("tr");
    const fields = record.draft.fields;
    const date = fields["estimate-date"];
    const total = moneyFormatter.format(estimateTotal(record.draft)).replace(/[\u00a0\u202f]/g, " ") + " " + fields.currency;
    const values = [fields["estimate-number"] || "—", /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split("-").reverse().join(".") : "—", fields.recipient || "—", total];
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    const cell = document.createElement("td");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "add-button";
    open.textContent = "Открыть";
    open.setAttribute("aria-label", "Открыть смету № " + (fields["estimate-number"] || "без номера"));
    open.addEventListener("click", () => openEstimate(record.id));
    cell.append(open);
    row.append(cell);
    body.append(row);
  }
  document.querySelector("#catalog-empty").hidden = rows.length !== 0;
  document.querySelector("#catalog-count").textContent = "Найдено: " + rows.length;
  document.querySelector("#catalog-status").textContent = document.querySelector("#catalog-from").value > document.querySelector("#catalog-to").value
    && document.querySelector("#catalog-to").value ? "Дата «От» должна быть не позже даты «До»." : "";
}

function showEditor() {
  document.querySelector("#estimate-catalog").hidden = true;
  document.querySelector("#estimate-editor").hidden = false;
  document.querySelector("#show-catalog").focus();
}

function openEstimate(id) {
  try {
    loadCatalog();
    const record = catalog.find(item => item.id === id);
    if (!record) throw new Error("Смета не найдена");
    if (!window.confirm("Открыть выбранную смету? Текущий черновик будет заменён. Несохранённые в каталоге изменения будут потеряны.")) return;
    isInitializing = true;
    try {
      items.replaceChildren();
      for (const field of fieldIds) document.getElementById(field).value = record.draft.fields[field];
      currentCatalogId = record.id;
      for (const position of record.draft.positions) addItem(false, position);
      updateCurrency();
    } finally { isInitializing = false; }
    clearCopyFeedback();
    saveDraft();
    document.querySelector("#catalog-save-status").textContent = "Смета открыта из каталога. Для сохранения правок нажмите «Сохранить смету».";
    showEditor();
  } catch {
    document.querySelector("#catalog-status").textContent = "Не удалось открыть смету: проверьте доступность хранилища и целостность каталога.";
  }
}

document.querySelector("#show-catalog").addEventListener("click", () => {
  if (pendingDuplicate) return;
  document.querySelector("#estimate-editor").hidden = true;
  document.querySelector("#estimate-catalog").hidden = false;
  try { loadCatalog(); renderCatalog(); }
  catch {
    document.querySelector("#catalog-items").replaceChildren();
    document.querySelector("#catalog-empty").hidden = true;
    document.querySelector("#catalog-count").textContent = "";
    document.querySelector("#catalog-status").textContent = "Не удалось загрузить каталог: хранилище недоступно или данные повреждены.";
  }
  document.querySelector("#catalog-title").focus();
});
document.querySelector("#close-catalog").addEventListener("click", showEditor);
for (const eventName of ["input", "change"]) document.querySelector("#catalog-filters").addEventListener(eventName, renderCatalog);

try { loadCatalog(); } catch { /* Ошибка каталога не мешает работе с черновиком. */ }
if (!restoreDraft()) resetEstimate("1");
isInitializing = false;
