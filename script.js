"use strict";

const items = document.querySelector("#items");
const template = document.querySelector("#item-template");
const totalOutput = document.querySelector("#total");
const addButton = document.querySelector("#add-item");
const discountInput = document.querySelector("#discount-rate");
const vatInput = document.querySelector("#vat-rate");
const currencyInput = document.querySelector("#currency");
const moneyFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

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

function addItem(focus = true) {
  const row = template.content.firstElementChild.cloneNode(true);
  items.append(row);
  if (focus) row.querySelector('[data-field="name"]').focus();
  updateCurrency();
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

const today = new Date();
document.querySelector("#estimate-date").value = [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, "0"),
  String(today.getDate()).padStart(2, "0"),
].join("-");

addItem(false);
