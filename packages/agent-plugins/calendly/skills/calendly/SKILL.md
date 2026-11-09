---
name: calendly
description: Put a live Calendly booking calendar on a site page, such as a contact page.
---

# Calendly

Use this when someone wants visitors to book time with them from their site.

## Adding the calendar

1. You need their public booking link, such as `https://calendly.com/their-name/30min`. If you do not have it, ask for it in one short question. It is on their Calendly "Scheduling" page under "Copy link". Do not make one up.
2. Read the page with `pages_read_html`, then place this where the calendar belongs, using `pages_write_region` or `pages_write_html`:

```html
<div data-embed-config='{"type":"plugin","plugin":"tovu/calendly","component":"booking-calendar","version":1,"props":{"url":"https://calendly.com/their-name/30min"}}'><a href="https://calendly.com/their-name/30min">Book a time</a></div>
```

The link inside the `div` is what visitors see if the calendar cannot load. Keep it, pointing at the same booking link.

Never write Calendly's `<script>` or `<iframe>` by hand. This embed handles loading, cookie consent, styling and static exports.

## What to tell the person

- The link must be a page on `https://calendly.com`. If the write is refused for the link, tell them it needs to look like the example above.
- If the site asks visitors about cookies, the calendar loads after a visitor allows functional cookies. Until then visitors see a link to the booking page.
- Calendly handles the bookings and confirmations. Nothing is stored on this site.

## Connecting a Calendly account is optional

The calendar never needs a sign-in. Only offer `agent_plugin_connect` if they want you to look up their event types or scheduled events through Calendly. This sign-in has not been tested with a real Calendly account yet; say so before relying on it.
