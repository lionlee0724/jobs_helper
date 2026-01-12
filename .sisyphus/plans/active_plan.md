# Active Plan: BOSS Platform Integration & Stabilization

## Context
The project aims to consolidate job application automation into `Universal_Job_Helper.js`. Currently, `Boss_helper.js` contains specific logic (like `sendImageResume` and some selectors) that needs to be fully integrated and verified in the universal script.

## Objectives
1.  Verify current BOSS selector stability.
2.  Port missing features (`sendImageResume`) to Universal script.
3.  Refactor selectors for better maintainability.
4.  Deprecate the standalone `Boss_helper.js`.

## Tasks

### 1. Verification Infrastructure
- [ ] **Create verification script**: `tests/verify_boss_selectors.js` using Playwright.
    -   Target `zhipin.com` job list and chat pages.
    -   Verify existence of critical elements: `job-card-box`, `btn-chat`, `toolbar-btn` (resume), etc.
    -   *Goal*: Ensure selectors in `Universal_Job_Helper.js` match current site structure.

### 2. Feature Gap Analysis & Porting
- [ ] **Analyze Gaps**: Compare `Boss_helper.js` `sendImageResume` vs `Universal_Job_Helper.js`.
- [ ] **Update Settings Schema**: Add `imageResumes` and `useAutoSendImageResume` to `BossStrategy.settings` in `Universal_Job_Helper.js`.
- [ ] **Port Feature**: Implement `sendImageResume` in `BossStrategy` class.
    -   Logic: Select image resume based on keywords (or default).
    -   Action: Handle file input `input[type="file"]` and dispatch change events.
    -   UI: Add controls for Image Resume settings in `renderSettings`.

### 3. Refactoring
- [ ] **Centralize Selectors**: Extract all hardcoded selectors in `Universal_Job_Helper.js` (BossStrategy) into the `SELECTORS.BOSS` constant.
- [ ] **Update References**: Ensure `BossStrategy` uses `SELECTORS.BOSS` references instead of string literals.

### 4. Documentation
- [ ] **Deprecate Legacy Script**: Update `README.md` to mark `Boss_helper.js` as deprecated.
- [ ] **Update Guides**: Direct users to `Universal_Job_Helper.js` for BOSS Zhipin support.

## Verification
- Run `tests/verify_boss_selectors.js` to confirm selector validity.
- Manual test of `Universal_Job_Helper.js` on BOSS Zhipin (user action required).
