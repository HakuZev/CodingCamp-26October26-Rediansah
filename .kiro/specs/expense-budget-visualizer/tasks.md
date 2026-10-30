# Implementation Plan: Expense & Budget Visualizer

## Overview

This plan implements a fully client-side Expense & Budget Visualizer as a single-page web application using HTML, a single CSS file (`css/style.css`), and a single vanilla JavaScript file (`js/app.js`). Chart.js (loaded via CDN) renders the pie chart. All application behavior lives in `js/app.js`, which declares pure logic functions at module top level and guards DOM/bootstrap code behind `typeof document !== 'undefined'`, conditionally exposing the pure functions via `module.exports` so Node-based property tests can import them directly.

The implementation follows a one-way data-flow architecture with a single in-memory `state.transactions` array as the source of truth. Pure functions (validation, storage codec, balance calculation, category aggregation, delete) carry the correctness-critical behavior and are the targets of property-based tests. DOM views re-render on every mutation so the list, balance, and chart stay in sync without a page reload.

Each task below builds on the previous ones, and the final task wires everything together. Testing tasks are sub-tasks marked optional with `*`; property-based tests each reference a specific design property and the requirement clause it validates.

## Tasks

- [x] 1. Set up project structure and static HTML/CSS scaffold
  - Create the directory structure: `css/`, `js/`, and `index.html` at the workspace root
  - Create `index.html` with the structure from the design document: header with `#balance-display`, `#transaction-form` (item name input, amount input, category `<select>`, submit button), `#transaction-list` scrollable container, `#category-chart` with `<canvas id="pie-chart">`, and a dismissible message area for storage errors
  - Include `<link rel="stylesheet" href="css/style.css" />` and the pinned Chart.js CDN `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>`
  - Load `js/app.js` with the `defer` attribute
  - Create `css/style.css` implementing the visual design rules: `:root` variables with body font 16px, `h2` at least 20px, `h1` at least 24px; `#transaction-list` with a bounded `max-height` and `overflow-y: auto` for scrolling
  - Create an empty `js/app.js` (populated in later tasks)
  - _Requirements: 6.1, 6.3, 9.1, 9.2, 2.2_

- [x] 2. Implement the pure validation and transaction factory logic
  - [x] 2.1 Implement `validateTransaction(input)` and `createTransaction(input)` in `js/app.js`
    - Define the `RawInput`, `ValidationResult`, and `Transaction` JSDoc typedefs from the design
    - `validateTransaction`: trim `itemName` (reject empty/whitespace-only and length > 100); parse `amount` to a finite number greater than zero (reject empty, non-numeric, `NaN`, zero, negative); require `category` to be exactly one of `"Food"`, `"Transport"`, `"Fun"` (reject empty `""` to enforce no pre-selection). Return a `ValidationResult` whose `errors` map contains each and only the offending field(s), and a normalized `transaction` when valid
    - `createTransaction`: build a `Transaction` from validated input, assigning a unique `id` via `generateId()`
    - `generateId`: use `crypto.randomUUID()` when available, otherwise a timestamp-plus-random fallback
    - _Requirements: 1.2, 1.3, 10.2, 10.3_

- [x] 3. Implement the pure calculators (balance and category aggregation)
  - [x] 3.1 Implement `calculateBalance(transactions)` and `aggregateByCategory(transactions)` in `js/app.js`
    - `calculateBalance`: sum all transaction `amount` values, rounded to two decimal places for display; return `0` for an empty list
    - `aggregateByCategory`: return one entry `{ category, amount }` per category that has at least one transaction, each `amount` equaling the sum of that category's amounts, and no entry for categories with zero transactions
    - Handle floating-point artifacts by rounding category sums to two decimal places
    - _Requirements: 3.1, 3.3, 4.3_
  
- [x] 4. Implement the pure storage codec and the pure delete operation
  - [x] 4.1 Implement `serializeTransactions(transactions)` and `deserializeTransactions(raw)` in `js/app.js`
    - `serializeTransactions`: `JSON.stringify` the transaction list
    - `deserializeTransactions`: `JSON.parse` plus structural validation per the design's rules (result is an array; every element has exactly `id`, `itemName`, `amount`, `category` of correct types; `itemName` trimmed length 1..100; `amount` finite and > 0; `category` one of the three valid values). Return `{ ok: true, transactions }` or `{ ok: false, error }`
    - Implement the pure delete helper `removeTransactionById(transactions, id)` used by the controller: returns a new list with the targeted `id` removed, preserving the order of the remaining transactions; leaves the list unchanged when `id` is absent
    - _Requirements: 2.3, 5.3, 5.6_

- [x] 5. Configure conditional Node exports for the pure functions
  - [x] 5.1 Add the `module.exports` guard to `js/app.js`
    - At the end of the pure-logic section, add `if (typeof module !== 'undefined' && module.exports) { module.exports = { validateTransaction, createTransaction, generateId, calculateBalance, aggregateByCategory, serializeTransactions, deserializeTransactions, removeTransactionById }; }` so Node-based property tests can import the pure functions while the browser ignores it
    - Confirm all DOM/bootstrap code is guarded by `if (typeof document !== 'undefined')` so requiring the module in Node does not touch the DOM
    - _Requirements: 6.2, 6.3_

- [ ] 6. Checkpoint - Ensure pure logic and property tests pass
  - Ensure all property tests (2.2, 2.3, 3.2, 3.3, 4.2, 4.3, 4.4) pass with fast-check at a minimum of 100 iterations each, ask the user if questions arise.

- [x] 7. Implement the storage adapter (localStorage I/O)
  - [x] 7.1 Implement `loadTransactions()` and `saveTransactions(transactions)` in `js/app.js`
    - Define `STORAGE_KEY = "expense-visualizer:transactions"`
    - `loadTransactions`: try/catch `localStorage.getItem`, pass the raw string to `deserializeTransactions`; on a missing key return `{ transactions: [], error: null }` (normal empty case); on a corrupt/invalid result return `{ transactions: [], error }` (initialize empty with an error message); never throw
    - `saveTransactions`: try/catch `localStorage.setItem`; on `QuotaExceededError` or any storage-unavailable exception return `{ ok: false, error }` without modifying the in-memory list; on success return `{ ok: true, error: null }`
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6_

- [x] 8. Implement the DOM views (list, balance, chart)
  - [x] 8.1 Implement `renderTransactionList(transactions)` and `renderBalance(transactions)` in `js/app.js`
    - `renderTransactionList`: render one row per transaction showing `itemName`, `amount`, and `category`, plus a delete control (button) per row carrying the transaction `id`; render no rows (optional empty-state hint) when the list is empty. The container's scroll is handled by CSS (`#transaction-list` bounded height + `overflow-y: auto`)
    - `renderBalance`: update the `#balance-display` content with the formatted `calculateBalance` result; display `0` when there are no transactions
    - _Requirements: 2.1, 2.4, 2.5, 3.1, 3.3_
  - [x] 8.2 Implement `renderChart(transactions)` in `js/app.js`
    - Create the Chart.js pie chart once on the `#pie-chart` canvas; update it in place with `chart.update()` for incremental changes
    - One slice per category with at least one transaction, labeled by category name, each slice value equaling the category sum from `aggregateByCategory`
    - When transactions is empty, `destroy()` the chart instance and show a "no spending data" placeholder; recreate the chart when data returns
    - Always `destroy()` the previous chart instance before recreating on the same canvas to avoid the stale-instance bug
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 9. Implement the controller, render orchestrator, and bootstrap
  - [x] 9.1 Implement `render()`, `handleSubmit(event)`, `handleDelete(transactionId)`, and `init()` in `js/app.js`
    - Define `state = { transactions: [] }` as the single source of truth
    - `render()`: call `renderTransactionList`, `renderBalance`, and `renderChart` so all three views stay in sync (no page reload)
    - `handleSubmit`: validate via `validateTransaction`; on valid, `createTransaction`, push to `state.transactions`, persist via `saveTransactions` (on failure keep the in-memory list and show a dismissible error), then `render()`; on invalid, render per-field validation messages into the form and do not mutate state. Wrap the body in try/catch so failures surface in the UI instead of becoming uncaught console exceptions
    - `handleDelete`: `removeTransactionById` from `state.transactions`, persist, then `render()`
    - `init()`: on `DOMContentLoaded`, call `loadTransactions` to populate `state.transactions` (surfacing a corrupt-data error when present), then `render()`. Wire the form `submit` event and the list's delete control (event delegation by `id`)
    - _Requirements: 1.2, 1.3, 2.3, 3.2, 4.2, 5.1, 5.2, 5.5, 5.6_

- [x] 10. Implement the form, category selector, and validation message wiring
  - [x] 10.1 Wire the Transaction_Form fields and validation message display in `js/app.js`
    - Ensure the form provides `Item_Name` (text input), `Amount` (number/text input), and `Category` (`<select>`) fields
    - The `Category` `<select>` presents exactly the options `Food`, `Transport`, `Fun`, is single-select, and renders with no category pre-selected (no `selected`/`value` on display)
    - On invalid submit, map each `ValidationResult.errors` entry to an inline message next to its field; clear messages on the next valid submit
    - _Requirements: 1.1, 1.3, 10.1, 10.3_

- [ ] 11. Checkpoint - Ensure integration and example tests pass
  - Ensure all integration and example tests pass, ask the user if questions arise.

- [x] 12. Write smoke/configuration tests for project structure, visual design, and scroll
  - [x] 12.1 Implement configuration tests for single-file and visual-design constraints
    - Assert `css/style.css` is the only CSS file under `css/`, `js/app.js` is the only JS file under `js/`, no JS framework is imported, and Chart.js is the only external script
    - Assert the computed body font-size is at least 16px, heading font-size is at least body + 4px, and `#transaction-list` has a bounded height with `overflow-y` scroll
    - _Requirements: 6.1, 6.3, 9.1, 9.2, 2.2_

    - _Requirements: 5.5_

- [ ] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP, but they are included in the dependency graph.
- Each task references specific requirements for traceability back to the requirements and design documents.
- The pure logic (tasks 2, 3, 4) is implemented before any DOM/storage code so it can be property-tested in isolation via the conditional `module.exports` added in task 5.
- Property-based tests use fast-check in Node, importing the pure functions directly from `js/app.js`; each runs at least 100 iterations and references its design property with a leading comment.
- Checkpoints (tasks 6, 11, 13) validate incrementally: pure logic first, then wired integration, then final full suite.

## Task Dependency Graph

The design mandates a single JavaScript file (`js/app.js`), so every implementation task that writes to `js/app.js` is serialized into its own wave to avoid concurrent-edit conflicts. Test tasks write to separate test files and may run in parallel with each other and with the single `js/app.js` task in their wave.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["4.1"] },
    { "id": 4, "tasks": ["5.1"] },
    { "id": 5, "tasks": ["7.1", "2.2", "2.3", "3.2", "3.3", "4.2", "4.3", "4.4"] },
    { "id": 6, "tasks": ["8.1"] },
    { "id": 7, "tasks": ["8.2"] },
    { "id": 8, "tasks": ["9.1"] },
    { "id": 9, "tasks": ["10.1", "9.2", "12.2", "12.3"] },
    { "id": 10, "tasks": ["10.2", "12.1"] }
  ]
}
```
