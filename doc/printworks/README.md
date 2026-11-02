# DUIS Printworks — Plan

This directory holds the plan for **DUIS Printworks**: a separate web shop for custom printing, logo merchandise and corporate gifting, run by the same company as the Duis store.

It is **not part of the Duis store app**. Printworks will be built in its own repository, copying and adapting the Duis code that fits. Nothing here changes how Duis works: `doc/` is outside the Docker image and Prettier's checks.

**Status (2026-11-02):** discovery is complete (11 rounds of questions with the owner). The plan is a draft for the owner's review; nothing has been built yet.

| File | What it answers |
|---|---|
| [development-plan.md](development-plan.md) | Context, the decisions at a glance (§0), the full plan (§1–17), the critical files and how to verify the build |
| [appendix-a-printmine-analysis.md](appendix-a-printmine-analysis.md) | How PrintMine.in works, and where Printworks improves on it |
| [appendix-b-duis-reuse-report.md](appendix-b-duis-reuse-report.md) | Which Duis-store code is reused, changed, dropped or built new, the exact files to copy, and the effort saved |
| [appendix-c-requirements-register.md](appendix-c-requirements-register.md) | Every confirmed requirement (R1–R47) and every assumption still to confirm (A1–A26) |

**Where to start:** §0 "Decisions at a glance" in the development plan is a one-page summary.

**Open before invoicing is built (phase P6):** the assumptions marked **CA** in Appendix C need the chartered accountant's confirmation: A4, A13, A20, A21 and A25.

When the Printworks repository is created, this directory moves there as the start of its own `doc/` set.
