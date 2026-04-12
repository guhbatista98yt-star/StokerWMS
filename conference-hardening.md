# Conference Hardening Plan

## Objectives
1. Understand the full conference flow (frontend and backend).
2. Root Cause Analysis (RCA) for Context Leak, Auto-completion, and Excess Handling.
3. Fix the state machine.
4. Provide comprehensive patch and tests.

## Steps
1. Audit frontend code (Conference Page, state, queries).
2. Audit backend code (endpoints in routes.ts or controllers, `checkAndCompleteWorkUnit`, `recalculateOrderStatus`).
3. Formulate minimal but deeply correct patches.
