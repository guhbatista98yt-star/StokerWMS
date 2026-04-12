# Rename Stokar to Stoker

## What & Why
The application name should be "Stoker" (with an 'e'), not "Stokar" (with an 'a'). All visible references — titles, headings, toasts, PWA manifest, meta tags, and offline page — need to be updated. The localStorage key prefix also uses "stokar:" and should be updated to "stoker:" for consistency.

## Done looks like
- Every place the user sees "Stokar" now shows "Stoker" instead
- The browser tab title reads "Stoker — Warehouse Management System"
- The PWA manifest name and short_name say "Stoker"
- The login page heading, toast, install button, and footer all say "Stoker"
- The offline fallback page title says "Stoker"
- The localStorage key prefix is updated from "stokar:" to "stoker:"

## Out of scope
- No functional or layout changes — this is a text-only rename

## Tasks
1. Replace all instances of "Stokar" with "Stoker" (case-sensitive) across all affected files
2. Replace the lowercase "stokar:" localStorage key prefix with "stoker:" in the auth module
3. Update the replit.md documentation references

## Relevant files
- `client/index.html:7,14,17,20`
- `client/public/offline.html:6`
- `client/src/pages/login.tsx:76,101,185,190`
- `client/src/pages/home.tsx:167`
- `client/src/pages/company-select.tsx:46`
- `client/src/pages/supervisor/mapping-studio.tsx:238`
- `client/src/lib/auth.tsx:7,38`
- `vite.config.ts:16,17,48`
- `replit.md:1,5`
