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
  if (focus) row.querySelector('[data-field="name"]').focus();
  updateCurrency();
  saveDraft();
}

addButton.addEventListener("click", () => addItem());
discountInput.addEventListener("input", recalculate);
vatInput.addEventListener("input", recalculate);
currencyInput.addEventListener("change", updateCurrency);
items.addEventListener("input", recalculate);
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
  addItem();
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
  const positions = Array.from(items.rows, row => Object.fromEntries(
    rowFields.map(field => [field, row.querySelector(`[data-field="${field}"]`).value])
  ));
  return { version: 1, fields, positions };
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
    if (!draft || draft.version !== 1 || !draft.fields || !Array.isArray(draft.positions)
      || !fieldIds.every(id => typeof draft.fields[id] === "string")
      || !["₸", "₽", "$", "€"].includes(draft.fields.currency)
      || !draft.positions.every(row => row && rowFields.every(field => typeof row[field] === "string")
        && ["шт", "час", "услуга"].includes(row.unit))) {
      throw new Error("Неверный формат черновика");
    }
    for (const id of fieldIds) document.getElementById(id).value = draft.fields[id];
    for (const position of draft.positions) addItem(false, position);
    updateCurrency();
    return true;
  } catch {
    document.querySelector("#draft-status").textContent = "Не удалось восстановить черновик. Хранилище недоступно или сохранённые данные повреждены.";
    return false;
  }
}

function resetEstimate(number) {
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
  document.querySelector("main").addEventListener(eventName, event => {
    if (event.target.matches("input, select, textarea") && event.target.id !== "share-text") saveDraft();
  });
}

if (!restoreDraft()) resetEstimate("1");
isInitializing = false;
