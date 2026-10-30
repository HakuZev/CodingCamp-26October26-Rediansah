// Expense & Budget Visualizer — application behavior (single JS file in js/ per Requirement 6.3).
// Pure logic, storage adapter, views, and controller are implemented in later tasks.
//
// All functions in this file are pure (no DOM, no storage) until the later
// tasks add the storage adapter, views, and controller behind DOM guards.

// ---------------------------------------------------------------------------
// Type definitions (shared by the pure logic layer).
// ---------------------------------------------------------------------------

/**
 * Raw, unvalidated strings straight from the form fields.
 * @typedef {Object} RawInput
 * @property {string} itemName  - raw text from the Item_Name field
 * @property {string} amount    - raw text from the Amount field
 * @property {string} category  - raw text from the Category selector ("" if none selected)
 */

/**
 * Result of validating a RawInput.
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {Object<string,string>} errors - map of fieldName -> message; empty when valid
 * @property {Object|null} transaction - normalized Transaction fields when valid, else null
 */

/**
 * The core domain object. All user-facing requirements operate on this shape.
 * @typedef {Object} Transaction
 * @property {string} id        - unique identifier (used to target delete); survives round-trip
 * @property {string} itemName   - trimmed label, length 1..100
 * @property {number} amount     - monetary value, finite and > 0
 * @property {string} category   - one of "Food" | "Transport" | "Fun"
 */

// ---------------------------------------------------------------------------
// Pure logic: validator and transaction factory (Requirement 1, Requirement 10).
// No DOM or storage access; these do not mutate their input.
// ---------------------------------------------------------------------------

/** Categories a transaction may belong to (Requirement 10.1). */
var VALID_CATEGORIES = ["Food", "Transport", "Fun"];

/**
 * Validate raw form input and normalize it when valid.
 *
 * Rules:
 *   itemName: trimmed length must be 1..100 (whitespace-only is invalid)
 *   amount:   must parse to a finite number > 0 (empty, non-numeric, NaN,
 *             zero, and negative are all invalid)
 *   category: must be exactly one of "Food" | "Transport" | "Fun"
 *             (no pre-selection => "" is invalid, Requirement 10.3)
 *
 * The `errors` map contains each and only the offending field(s). When the
 * input is valid, `transaction` holds the normalized fields (trimmed
 * itemName, parsed amount, category) without an id; `createTransaction`
 * assigns the id. This keeps re-validation idempotent so the same valid
 * input never produces duplicate ids.
 * @param {RawInput} input
 * @returns {ValidationResult}
 */
function validateTransaction(input) {
  var errors = {};

  // Item Name: trimmed length must be 1..100.
  var itemNameRaw = input.itemName == null ? "" : String(input.itemName);
  var itemName = itemNameRaw.trim();
  if (itemName.length < 1) {
    errors.itemName = "Item name is required.";
  } else if (itemName.length > 100) {
    errors.itemName = "Item name must be 100 characters or fewer.";
  }

  // Amount: must parse to a finite number greater than zero.
  var amountRaw = input.amount == null ? "" : String(input.amount);
  var amountStr = amountRaw.trim();
  var amount = Number(amountStr);
  if (amountStr === "" || !Number.isFinite(amount) || amount <= 0) {
    errors.amount = "Amount must be a positive number greater than zero.";
  }

  // Category: must be exactly one of the three valid values.
  var category = input.category == null ? "" : String(input.category);
  if (category !== "Food" && category !== "Transport" && category !== "Fun") {
    errors.category = "Category must be one of Food, Transport, or Fun.";
  }

  var valid = Object.keys(errors).length === 0;
  var transaction = null;
  if (valid) {
    transaction = {
      itemName: itemName,
      amount: amount,
      category: category
    };
  }
  return { valid: valid, errors: errors, transaction: transaction };
}

/**
 * Build a Transaction from validated input, assigning a unique id.
 * @param {{ itemName: string, amount: number, category: string }} normalizedInput
 *   input that has already passed validation (the `transaction` field of a
 *   valid ValidationResult)
 * @returns {Transaction}
 */
function createTransaction(normalizedInput) {
  return {
    id: generateId(),
    itemName: normalizedInput.itemName,
    amount: normalizedInput.amount,
    category: normalizedInput.category
  };
}

/**
 * Generate a unique id. Uses crypto.randomUUID() when available, otherwise a
 * timestamp-plus-random fallback for older browsers.
 * @returns {string}
 */
function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + random (sufficient for client-side id generation).
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

// ---------------------------------------------------------------------------
// Pure logic: calculators (balance and category aggregation).
// No DOM or storage access; these do not mutate their input.
// ---------------------------------------------------------------------------

/**
 * Round a number to two decimal places, absorbing floating-point artifacts.
 * Adding Number.EPSILON before scaling mitigates binary rounding errors so
 * that, e.g., 0.1 + 0.2 rounds cleanly to 0.3 instead of 0.30000000000000004.
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Compute the total balance as the sum of all transaction amounts.
 * @param {Transaction[]} transactions
 * @returns {number}  // rounded to 2 decimal places for display
 */
function calculateBalance(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return 0;
  }
  const sum = transactions.reduce(function (total, t) {
    return total + t.amount;
  }, 0);
  return round2(sum);
}

/**
 * Aggregate transaction amounts by category.
 * Returns one entry per category that has at least one transaction, in order of
 * first appearance (Map preserves insertion order for deterministic output).
 * No entry is produced for categories with zero transactions.
 * @param {Transaction[]} transactions
 * @returns {Array<{ category: string, amount: number }>}
 *   // one entry per category that has >= 1 transaction, amount = sum of that category's amounts
 */
function aggregateByCategory(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return [];
  }
  // Map keyed by category, preserving insertion order.
  const sums = new Map();
  transactions.forEach(function (t) {
    sums.set(t.category, (sums.get(t.category) || 0) + t.amount);
  });
  const result = [];
  sums.forEach(function (amount, category) {
    result.push({ category: category, amount: round2(amount) });
  });
  return result;
}

// ---------------------------------------------------------------------------
// Pure logic: storage codec and delete helper (Requirement 2.3, Requirement 5).
// No DOM or storage access; serialize/deserialize are symmetric and the delete
// helper does not mutate its input.
// ---------------------------------------------------------------------------

/**
 * Serialize a transaction list to a JSON string for storage.
 * Non-array input is serialized defensively as an empty list so the stored
 * representation is always a valid JSON array.
 * @param {Transaction[]} transactions
 * @returns {string}
 */
function serializeTransactions(transactions) {
  if (!Array.isArray(transactions)) {
    return "[]";
  }
  return JSON.stringify(transactions);
}

/**
 * Deserialize a stored JSON string back into a transaction list.
 * Returns a Result: on failure (bad JSON or invalid structure) reports an
 * error. Structural validation enforces that the parsed value is an array
 * whose every element is an object with exactly the four Transaction fields
 * of the correct types, so corrupt or schema-mismatched data is rejected
 * rather than rendered (Requirement 5.6).
 * @param {string} raw
 * @returns {{ ok: true, transactions: Transaction[] } | { ok: false, error: string }}
 */
function deserializeTransactions(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: "Stored data is not valid JSON." };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: "Stored data is not an array." };
  }

  const requiredKeys = ["id", "itemName", "amount", "category"];

  for (let i = 0; i < parsed.length; i++) {
    const element = parsed[i];

    // Each element must be a plain object (not null, not an array).
    if (element == null || typeof element !== "object" || Array.isArray(element)) {
      return { ok: false, error: "Transaction at index " + i + " is not an object." };
    }

    // Exactly the four Transaction fields: no missing, no extra.
    const keys = Object.keys(element);
    if (keys.length !== 4) {
      return { ok: false, error: "Transaction at index " + i + " must have exactly the fields id, itemName, amount, and category." };
    }
    for (let k = 0; k < requiredKeys.length; k++) {
      if (!Object.prototype.hasOwnProperty.call(element, requiredKeys[k])) {
        return { ok: false, error: "Transaction at index " + i + " is missing field '" + requiredKeys[k] + "'." };
      }
    }

    // id: string
    if (typeof element.id !== "string") {
      return { ok: false, error: "Transaction at index " + i + " has an invalid 'id' (must be a string)." };
    }

    // itemName: string with trimmed length 1..100
    if (typeof element.itemName !== "string") {
      return { ok: false, error: "Transaction at index " + i + " has an invalid 'itemName' (must be a string)." };
    }
    const trimmedName = element.itemName.trim();
    if (trimmedName.length < 1 || trimmedName.length > 100) {
      return { ok: false, error: "Transaction at index " + i + " has an invalid 'itemName' (trimmed length must be 1..100)." };
    }

    // amount: finite number > 0
    if (typeof element.amount !== "number" || !Number.isFinite(element.amount) || element.amount <= 0) {
      return { ok: false, error: "Transaction at index " + i + " has an invalid 'amount' (must be a finite number greater than zero)." };
    }

    // category: one of the three valid values
    if (VALID_CATEGORIES.indexOf(element.category) === -1) {
      return { ok: false, error: "Transaction at index " + i + " has an invalid 'category' (must be Food, Transport, or Fun)." };
    }
  }

  return { ok: true, transactions: parsed };
}

/**
 * Return a new transaction list with the transaction matching `id` removed,
 * preserving the order of the remaining transactions (Requirement 2.3). If
 * `id` is not present, the list is returned unchanged (a shallow copy). The
 * input list is never mutated. Non-array input yields an empty list.
 * @param {Transaction[]} transactions
 * @param {string} id
 * @returns {Transaction[]}
 */
function removeTransactionById(transactions, id) {
  if (!Array.isArray(transactions)) {
    return [];
  }
  return transactions.filter(function (t) {
    return t.id !== id;
  });
}

// ---------------------------------------------------------------------------
// Currency formatter — Rupiah (IDR) without decimals, with thousand separators.
// Works in both browser (Intl) and Node. Used by all view helpers.
// ---------------------------------------------------------------------------
/**
 * Format a number as Indonesian Rupiah.
 * Example: 15000 → "Rp15.000"
 * @param {number} value
 * @returns {string}
 */
function formatRupiah(value) {
  var rounded = Math.round(value);
  // Use Intl.NumberFormat when available (modern browsers + Node 13+).
  if (typeof Intl !== "undefined" && Intl.NumberFormat) {
    return "Rp" + new Intl.NumberFormat("id-ID").format(rounded);
  }
  // Fallback: manual thousand separator with dot.
  return "Rp" + rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// ---------------------------------------------------------------------------
// Conditional Node exports: expose pure functions for property-based tests.
// The browser ignores this block (module is undefined); Node uses it to import
// the pure functions without touching the DOM (Requirement 6.2, 6.3).
// ---------------------------------------------------------------------------
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    validateTransaction: validateTransaction,
    createTransaction: createTransaction,
    generateId: generateId,
    calculateBalance: calculateBalance,
    aggregateByCategory: aggregateByCategory,
    serializeTransactions: serializeTransactions,
    deserializeTransactions: deserializeTransactions,
    removeTransactionById: removeTransactionById
  };
}

// ---------------------------------------------------------------------------
// DOM/bootstrap code begins here (implemented in later tasks).
// ALL code below this point MUST be wrapped in `if (typeof document !== "undefined")`
// so requiring this module in Node does not touch the DOM (Requirement 6.2, 6.3).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Storage adapter (DOM/storage dependent) — wraps localStorage with defensive
// error handling (Requirements 5.1, 5.2, 5.4, 5.5, 5.6).
//
// STORAGE_KEY, loadTransactions, and saveTransactions are declared at module
// scope (outside the DOM guard) so the controller implemented in later tasks
// can call them from within its own `if (typeof document !== "undefined")`
// block. They are assigned only inside the DOM guard below, so requiring this
// module in pure Node leaves them undefined and never touches localStorage
// (Requirement 6.2/6.3); the bare `var` declarations perform no DOM/storage
// access. Every localStorage call is wrapped in try/catch with a
// `typeof localStorage` guard, so the functions never throw and degrade
// gracefully when storage is unavailable (e.g. Safari private-browsing mode).
// ---------------------------------------------------------------------------
var STORAGE_KEY;
var loadTransactions;
var saveTransactions;
if (typeof document !== "undefined") {
  STORAGE_KEY = "expense-visualizer:transactions";

  /**
   * Load transactions from localStorage.
   *
   * - A missing key is the normal empty-list case and returns `[]` with no
   *   error (Requirement 5.4).
   * - Corrupt/invalid stored data is detected by `deserializeTransactions` and
   *   surfaced as an error with an empty list (Requirement 5.6).
   * - Any storage failure (e.g. storage unavailable) is caught and reported
   *   with an empty list. This function never throws.
   * @returns {{ transactions: Transaction[], error: string|null }}
   *   - error is null on success (including "no data => empty list")
   *   - error is set when data is corrupt or storage fails; transactions is []
   *     in that case
   */
  loadTransactions = function () {
    try {
      if (typeof localStorage === "undefined" || localStorage === null) {
        return { transactions: [], error: "Local storage is not available." };
      }
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) {
        // No saved data: initialize with an empty list (Requirement 5.4).
        return { transactions: [], error: null };
      }
      var result = deserializeTransactions(raw);
      if (result.ok) {
        return { transactions: result.transactions, error: null };
      }
      // Corrupt/invalid data: initialize empty and surface the error (5.6).
      return { transactions: [], error: result.error };
    } catch (e) {
      var detail = e && e.message ? e.message : (e && e.name ? e.name : String(e));
      return { transactions: [], error: "Failed to read transactions from local storage: " + detail };
    }
  };

  /**
   * Persist transactions to localStorage.
   *
   * - On success returns `{ ok: true, error: null }`.
   * - On `QuotaExceededError` or any storage-unavailable exception returns
   *   `{ ok: false, error }` WITHOUT modifying the in-memory list. This
   *   function holds no reference to the in-memory list, so it cannot modify
   *   it; it only reports the failure so the controller keeps
   *   `state.transactions` intact (Requirement 5.5). This function never throws.
   * @param {Transaction[]} transactions
   * @returns {{ ok: boolean, error: string|null }}
   */
  saveTransactions = function (transactions) {
    try {
      if (typeof localStorage === "undefined" || localStorage === null) {
        return { ok: false, error: "Local storage is not available." };
      }
      var serialized = serializeTransactions(transactions);
      localStorage.setItem(STORAGE_KEY, serialized);
      return { ok: true, error: null };
    } catch (e) {
      var detail = e && e.message ? e.message : (e && e.name ? e.name : String(e));
      return { ok: false, error: "Failed to save transactions to local storage: " + detail };
    }
  };
}

// ---------------------------------------------------------------------------
// View helpers (DOM dependent) — render the transaction list and balance
// display (Requirements 2.1, 2.4, 2.5, 3.1, 3.3).
//
// Both functions are declared as vars outside the guard and assigned inside it
// so the controller (added in a later task) can call them from its own DOM
// block without having to re-declare them. Requiring this module in Node
// leaves them undefined and never touches the DOM (Requirement 6.2/6.3).
// ---------------------------------------------------------------------------
var renderTransactionList;
var renderBalance;
if (typeof document !== "undefined") {
  /**
   * Render the transaction list into `#transaction-list`.
   *
   * - Clears the container on every call and rebuilds it from scratch so the
   *   view is always consistent with the current state (Requirement 2.1).
   * - Each row shows itemName, amount (2 decimal places), and category, plus a
   *   delete button carrying the transaction's id in `data-id` so the
   *   controller can use event delegation (Requirements 2.4, 2.5).
   * - When the list is empty an empty-state hint is shown instead (Req 2.4).
   * - Scroll behaviour is handled purely by CSS on #transaction-list
   *   (max-height + overflow-y: auto); no inline scroll styles are set here.
   *
   * @param {Transaction[]} transactions
   */
  renderTransactionList = function (transactions) {
    var container = document.getElementById("transaction-list");
    if (!container) return;

    // Clear previous content.
    container.innerHTML = "";

    if (!Array.isArray(transactions) || transactions.length === 0) {
      var empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No transactions yet.";
      container.appendChild(empty);
      return;
    }

    transactions.forEach(function (t) {
      var row = document.createElement("div");
      row.className = "transaction-row";

      var name = document.createElement("span");
      name.className = "transaction-item-name";
      name.textContent = t.itemName;

      var amount = document.createElement("span");
      amount.className = "transaction-amount";
      amount.textContent = formatRupiah(t.amount);

      var category = document.createElement("span");
      category.className = "transaction-category";
      category.textContent = t.category;

      var deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-btn";
      deleteBtn.type = "button";
      deleteBtn.textContent = "Delete";
      deleteBtn.setAttribute("data-id", t.id);

      row.appendChild(name);
      row.appendChild(amount);
      row.appendChild(category);
      row.appendChild(deleteBtn);

      container.appendChild(row);
    });
  };

  /**
   * Render the current balance into `#balance-display`.
   *
   * Calls `calculateBalance(transactions)` and writes the result as a
   * formatted dollar amount (2 decimal places). Shows `$0.00` when the list
   * is empty (Requirements 3.1, 3.3).
   *
   * @param {Transaction[]} transactions
   */
  renderBalance = function (transactions) {
    var el = document.getElementById("balance-display");
    if (!el) return;

    var balance = calculateBalance(transactions);
    el.textContent = formatRupiah(balance);
  };
}

// ---------------------------------------------------------------------------
// Chart instance (module-level) — persists across renderChart calls so we
// can update in place rather than destroying and recreating on every render.
// Declared outside the DOM guard so it survives across multiple calls from
// within the controller's own DOM block (Requirement 4).
// ---------------------------------------------------------------------------
var chartInstance = null;

// ---------------------------------------------------------------------------
// View helper: pie chart (DOM + Chart.js dependent) — renders a pie chart of
// spending by category (Requirement 4).
//
// Chart.js 4.4.1 is loaded via CDN in index.html as a global `Chart` object.
// We never import it here.
//
// renderChart is declared as a var outside the guard and assigned inside it
// so the controller (added in a later task) can call it from its own DOM
// block. Requiring this module in Node leaves it undefined and never touches
// the DOM (Requirement 6.2/6.3).
// ---------------------------------------------------------------------------
var renderChart;
if (typeof document !== "undefined") {
  /**
   * Render (or update) the pie chart inside `#category-chart`.
   *
   * Behaviour:
   *   - Non-empty transactions: aggregate by category, then either update the
   *     existing `chartInstance` in place (avoid flicker) or create a new one
   *     when none exists.
   *   - Empty transactions: destroy any existing instance, hide the canvas,
   *     and show a "no spending data" placeholder.
   *   - Data returning after empty: remove the placeholder, show the canvas,
   *     then create a fresh chart.
   *
   * @param {Transaction[]} transactions
   */
  renderChart = function (transactions) {
    var section = document.getElementById("category-chart");
    var canvas  = document.getElementById("pie-chart");
    if (!section || !canvas) return;

    // Colors mapped to the three valid categories in a consistent order.
    var CATEGORY_COLORS = {
      Food:      "#FF6384",
      Transport: "#36A2EB",
      Fun:       "#FFCE56"
    };
    // Fallback palette for any unexpected future categories.
    var FALLBACK_COLORS = ["#4BC0C0", "#9966FF", "#FF9F40"];

    // ------------------------------------------------------------------
    // Empty-state path: no transactions → hide canvas, show placeholder.
    // ------------------------------------------------------------------
    if (!Array.isArray(transactions) || transactions.length === 0) {
      // Destroy stale chart so Chart.js doesn't leak it.
      if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
      }

      // Hide the canvas element.
      canvas.style.display = "none";

      // Show placeholder (already in HTML, just unhide it).
      var emptyEl = section.querySelector(".chart-empty-state");
      if (emptyEl) { emptyEl.style.display = ""; }
      return;
    }

    // ------------------------------------------------------------------
    // Data path: transactions present → show canvas, remove placeholder.
    // ------------------------------------------------------------------
    canvas.style.display = "";

    // Hide the static empty-state placeholder when data is present.
    var existing = section.querySelector(".chart-empty-state");
    if (existing) { existing.style.display = "none"; }

    // Aggregate spending by category.
    var aggregated = aggregateByCategory(transactions);
    var labels  = aggregated.map(function (entry) { return entry.category; });
    var amounts = aggregated.map(function (entry) { return entry.amount;   });
    var colors  = aggregated.map(function (entry, i) {
      return CATEGORY_COLORS[entry.category] || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
    });

    if (chartInstance) {
      // Update in place to avoid destroying/recreating the canvas context,
      // which prevents the Chart.js "Canvas is already in use" stale-instance bug.
      chartInstance.data.labels              = labels;
      chartInstance.data.datasets[0].data   = amounts;
      chartInstance.data.datasets[0].backgroundColor = colors;
      chartInstance.update();
    } else {
      // Destroy any lingering stale instance on the canvas before creating a new one.
      if (Chart.getChart && Chart.getChart(canvas)) {
        Chart.getChart(canvas).destroy();
      }
      chartInstance = new Chart(canvas, {
        type: "pie",
        data: {
          labels: labels,
          datasets: [{
            data: amounts,
            backgroundColor: colors,
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: "bottom"
            },
            tooltip: {
              callbacks: {
                label: function (context) {
                  var label  = context.label || "";
                  var value  = context.parsed;
                  return label + ": " + formatRupiah(value);
                }
              }
            }
          }
        }
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Controller and bootstrap (DOM dependent) — render orchestrator, form
// submission handler, delete handler, and init (Requirements 1.2, 1.3, 2.3,
// 3.2, 4.2, 5.1, 5.2, 5.5, 5.6, 9.1, 10.1, 10.3).
//
// All code in this block is inside the DOM guard so requiring this module in
// Node never touches the DOM (Requirement 6.2/6.3).
// ---------------------------------------------------------------------------
if (typeof document !== "undefined") {
  /**
   * Single in-memory source of truth (Requirement 3.2, 4.2 — no page reload).
   * @type {{ transactions: Transaction[] }}
   */
  var state = { transactions: [] };

  // -------------------------------------------------------------------------
  // Validation message helpers (Requirements 1.3, 10.1, 10.3)
  // -------------------------------------------------------------------------

  /**
   * Field-to-error-element id map. Matches the IDs in index.html.
   */
  var FIELD_ERROR_IDS = {
    itemName: "item-name-error",
    amount:   "amount-error",
    category: "category-error"
  };

  /**
   * Show inline validation messages for each offending field, and clear
   * messages for fields that are now valid. The presence of a non-empty
   * message string in `errors` determines whether a field is highlighted.
   *
   * @param {Object<string,string>} errors - map of fieldName -> message
   */
  function showValidationErrors(errors) {
    Object.keys(FIELD_ERROR_IDS).forEach(function (field) {
      var el = document.getElementById(FIELD_ERROR_IDS[field]);
      if (!el) return;
      var msg = errors[field] || "";
      el.textContent = msg;
      // Add/remove an invalid class on the associated input/select for visual feedback.
      var inputEl = document.getElementById(field === "itemName" ? "item-name" : field);
      if (inputEl) {
        if (msg) {
          inputEl.setAttribute("aria-invalid", "true");
        } else {
          inputEl.removeAttribute("aria-invalid");
        }
      }
    });
  }

  /**
   * Clear all inline validation messages.
   */
  function clearValidationErrors() {
    showValidationErrors({});
  }

  // -------------------------------------------------------------------------
  // Storage error message display helper (Requirements 5.5, 5.6)
  // -------------------------------------------------------------------------

  /**
   * Show a dismissible error message in `#message-area`.
   * @param {string} message
   */
  function showStorageError(message) {
    var area = document.getElementById("message-area");
    var text = document.getElementById("message-text");
    if (!area || !text) return;
    text.textContent = message;
    area.removeAttribute("hidden");
  }

  /**
   * Hide the storage error message area.
   */
  function hideStorageError() {
    var area = document.getElementById("message-area");
    if (area) area.setAttribute("hidden", "");
  }

  // -------------------------------------------------------------------------
  // Render orchestrator — calls all three views in sync (Requirements 3.2, 4.2)
  // -------------------------------------------------------------------------

  /**
   * Re-render every view from the current state. No page reload needed.
   */
  function render() {
    renderTransactionList(state.transactions);
    renderBalance(state.transactions);
    renderChart(state.transactions);
  }

  // -------------------------------------------------------------------------
  // handleSubmit — validate, create, persist, render (Requirements 1.2, 1.3)
  // -------------------------------------------------------------------------

  /**
   * Handle Transaction_Form submission.
   *   - Validate raw form input via validateTransaction.
   *   - On INVALID: show per-field validation messages; do not mutate state.
   *   - On VALID:   create transaction, push to state, persist, render,
   *                 clear errors, and reset the form.
   * Wrapped in try/catch so failures surface in the UI (Requirement 7).
   * @param {Event} event
   */
  function handleSubmit(event) {
    event.preventDefault();
    try {
      var form = event.target;

      // Read raw values from the form fields.
      var rawInput = {
        itemName: (form.elements["itemName"] || { value: "" }).value,
        amount:   (form.elements["amount"]   || { value: "" }).value,
        category: (form.elements["category"] || { value: "" }).value
      };

      var result = validateTransaction(rawInput);

      if (!result.valid) {
        // Show per-field inline messages (Requirement 1.3).
        showValidationErrors(result.errors);
        return;
      }

      // Input is valid: create transaction, update state, persist.
      var transaction = createTransaction(result.transaction);
      state.transactions = state.transactions.concat([transaction]);

      var saveResult = saveTransactions(state.transactions);
      if (!saveResult.ok) {
        // Keep in-memory list intact; surface a dismissible error (Req 5.5).
        showStorageError(saveResult.error);
      } else {
        hideStorageError();
      }

      // Clear validation errors and reset form on successful add.
      clearValidationErrors();
      form.reset();

      // Re-render all views (Requirement 3.2, 4.2).
      render();
    } catch (e) {
      var detail = e && e.message ? e.message : String(e);
      showStorageError("An unexpected error occurred: " + detail);
    }
  }

  // -------------------------------------------------------------------------
  // handleDelete — remove transaction, persist, render (Requirement 2.3)
  // -------------------------------------------------------------------------

  /**
   * Handle a delete control click for the given transaction id.
   *   - Remove from state, persist, re-render.
   * @param {string} transactionId
   */
  function handleDelete(transactionId) {
    try {
      state.transactions = removeTransactionById(state.transactions, transactionId);

      var saveResult = saveTransactions(state.transactions);
      if (!saveResult.ok) {
        showStorageError(saveResult.error);
      } else {
        hideStorageError();
      }

      render();
    } catch (e) {
      var detail = e && e.message ? e.message : String(e);
      showStorageError("An unexpected error occurred: " + detail);
    }
  }

  // -------------------------------------------------------------------------
  // init — bootstrap on DOMContentLoaded (Requirements 5.1, 5.2)
  // -------------------------------------------------------------------------

  /**
   * Bootstrap the application:
   *   1. Load saved transactions from localStorage.
   *   2. Surface corrupt-data errors if present.
   *   3. Render the initial state.
   *   4. Wire the form submit event.
   *   5. Wire delete controls via event delegation on #transaction-list.
   *   6. Wire the dismiss button on the error message area.
   */
  function init() {
    // Load saved state (Requirements 5.2, 5.4, 5.6).
    var loaded = loadTransactions();
    state.transactions = loaded.transactions;
    if (loaded.error) {
      showStorageError(loaded.error);
    }

    // Initial render.
    render();

    // Wire form submission (Requirement 1.2).
    var form = document.getElementById("expense-form");
    if (form) {
      form.addEventListener("submit", handleSubmit);
    }

    // Event delegation for delete buttons on #transaction-list (Requirement 2.3).
    var listContainer = document.getElementById("transaction-list");
    if (listContainer) {
      listContainer.addEventListener("click", function (event) {
        var btn = event.target;
        if (btn && btn.classList.contains("delete-btn")) {
          var id = btn.getAttribute("data-id");
          if (id) {
            handleDelete(id);
          }
        }
      });
    }

    // Wire the dismiss button on the storage-error message area.
    var dismissBtn = document.getElementById("message-dismiss");
    if (dismissBtn) {
      dismissBtn.addEventListener("click", hideStorageError);
    }
  }

  // Bootstrap: kick off when the DOM is ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    // DOMContentLoaded has already fired (e.g. script loaded non-deferred).
    init();
  }
}
