# DashCal

A spatial calendar that removes one assumption every calendar app shares: that every day is equal.

DashCal is a horizontal-scrolling canvas. Days can be any height. Quiet days can share a column. Days that don't belong to your project can disappear entirely. The canvas becomes the shape of your actual work — not the shape of the month.

Free, open source, local-first. No account, no cloud, no friction.

---

![DashCal](assets/screenshot.png)

---

## Try it
→ [dashable.co.uk/dashcal](https://dashable.co.uk/dashcal)

## Watch the build
Episode 1 of Dashability — the full story of how DashCal was built, the assumption it removes, and what fell out of the gaps.

→ [Watch on YouTube](https://youtu.be/t1yevHlFXzE)

## About Dashability
Dashability is a build-in-public channel about finding the assumptions nobody questions in everyday software — and replacing them at the root. Each episode deconstructs one category, removes one foundational assumption, and ships working open-source code as proof.

→ [dashable.co.uk](https://dashable.co.uk)

## Run it locally
Clone the repo and open with VS Code Live Server. No build step, no dependencies to install.

## Code structure
Eleven ES modules, each named after the part of the screen it controls — `calendar.js`, `sidebar.js`, `toolbar.js`, and so on. `app.js` is a thin coordinator.

## Licence
MIT
