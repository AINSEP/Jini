# Job forms


## Build V3: forms. Owner approved (11-05).
Plan: cloud/plans/V-forms-plan-result.md. Owner decisions: uncollected Cloudflare answers never auto-expire (show pending counts); copying a form leaves notification recipients local, shown in the preview; Formspree first, Google Forms later (do not build Google).
Trim, which OVERRIDES the plan:
- Do step 2 and step 5 in full.
- Step 3 only: capture labels, consent wording and schema hash in the existing envelope; old rows say "original schema/consent unavailable". CUT stale-form detection, moving import orchestration to Jini, recovering errors from old reports.
- Step 4: NOT in this job; a separate plan covers the cap. Step 1: release handles it, no job.
- All CUT-CANDIDATES stay cut. Report exactly what must be republished to Cloudflare.



## Build V4: public form uploads can't fill the disk
Plan: cloud/plans/V2-cap-replan-result.md. Trim, which OVERRIDES the plan:
- NO directory walk: it would run per public upload, and counting all site media would refuse attachments on any site with a few videos. No 256 MiB cap.
- One free-disk check only: one statfs on the uploads root before the first file write. Refuse the attachment batch if free space minus incoming bytes would fall under 512 MiB. Unreadable statfs: warn and allow, no refusal.
- Remote object stores skip the check: no local disk at risk. Do NOT refuse their attachments.
- Keep step 4 (retry page keeps answers; message: "This site has no room for another attachment. Your answers are kept below. Your form has not been sent.") and the JSON equivalent.
- Generic check in Jini behind a port, Tovu wires the path. At most 80 lines including tests. Cost: one statfs per attachment-bearing submission.
