# Phase 2, 3, & 4 Implementation Plan (v3.1)

## Overview
This document details the specific steps for verifying BOSS selectors, enhancing async robustness, and improving engineering standards (testing & logging).

## Phase 2: BOSS Selectors & DOM Stability

### Objective
Ensure that the selectors for BOSS Zhipin are accurate and robust against minor site changes.

### Tasks
1.  **Selector Review**:
    *   Target File: `Universal_Job_Helper.js` -> `SELECTORS.BOSS`
    *   Verify:
        *   Job Card: `li.job-card-box`
        *   Job Title: `.job-name`
        *   Chat Button: `a.op-btn-chat`
    *   **Action**: Add multiple fallback selectors where applicable (e.g., attribute-based selectors).

2.  **Selector Validation Script**:
    *   Create a standalone script or expand `tests/verify_boss_selectors.js` to run against a provided HTML snippet (mock data) to ensure selectors match.

## Phase 3: Async Flow & Robustness

### Objective
Eliminate race conditions and "element not found" errors by improving the waiting mechanism.

### Tasks
1.  **Enhance `Core.waitForElement`**:
    *   Current Implementation: MutationObserver with single timeout.
    *   **New Implementation**:
        *   Add **Retry Logic**: If the observer times out, try a direct query fallback once more.
        *   Add **Polling Fallback**: Option to use `setInterval` if MutationObserver fails (useful for some dynamic frameworks).
    *   Update signature: `waitForElement(selector, timeout, options = { retry: 3, polling: false })`

2.  **Implement `Core.retry`**:
    *   Create a generic retry utility:
        ```javascript
        async retry(operation, maxRetries = 3, delay = 1000)
        ```
    *   Use this for network requests and critical DOM interactions (like clicking 'Chat').

3.  **Refactor Strategy Methods**:
    *   Update `BossStrategy.processJobCard` to use the new `retry` mechanism for clicking buttons.

## Phase 4: Engineering Standards

### Objective
Establish a solid testing foundation and unified logging.

### Tasks
1.  **Unit Tests for Core Utilities**:
    *   Create `tests/core_utils.test.js`.
    *   Test cases for:
        *   `Core.extractTwoCharKeywords`
        *   `Core.delay` (mock timers)
        *   `StorageManager` (mock GM_getValue/setValue)

2.  **Standardize Logging**:
    *   Scan codebase for `console.log`.
    *   Replace all `console.log` with `Core.log(msg, 'INFO')`.
    *   Replace `console.error` with `Core.handleError`.

3.  **JSDoc Updates**:
    *   Ensure all new/modified functions in `Universal_Job_Helper.js` have complete JSDoc comments (params, returns, description).

## Execution Order
1.  **Phase 3 (Async)** first: This builds the foundation for reliable selector operations.
2.  **Phase 4 (Engineering)**: Write tests for the new Async tools immediately.
3.  **Phase 2 (Selectors)**: Apply the robust async tools to the specific BOSS selectors.
