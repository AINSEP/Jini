# A free WordPress.com address

For a `name.wordpress.com` address, the owner cannot point its DNS at Vercel or another
host: the free address does not grant control of the `wordpress.com` zone.
External-subdomain DNS requires an owned domain.
[Owned-domain requirement](https://wordpress.com/support/domains/connect-a-subdomain-to-an-external-site/).

## Choose an option

| Option | What to do |
|---|---|
| Buy a domain | Attach it to the existing host, such as Vercel, and verify it first. Separately buy Site Redirect from the old WordPress.com address to it. [Vercel domain setup](https://vercel.com/docs/domains/working-with-domains/add-a-domain), [Site Redirect](https://wordpress.com/support/domains/site-redirect/) |
| Use the host URL | Site Redirect to the actual host URL: **confirm in your dashboard**. Non-owned destinations such as `.vercel.app` are not explicitly confirmed. [Destination guidance](https://wordpress.com/support/domains/site-redirect/) |
| Put the files on WordPress | Plugin-based HTML hosting on WordPress.com requires a paid plan; Free cannot install plugins. Paid plans include Personal. Direct HTML-bundle publishing (mode B) is on hold here; an upgrade alone does not enable it here. [Plan features](https://wordpress.com/support/plan-features/) |

**A redirect changes the address bar to the destination.** It does not mirror
the external site under the WordPress.com address.
[Redirect behavior](https://wordpress.com/support/domains/site-redirect/).

## Price and setup

Current price: **confirm in your dashboard**. The
[current guide](https://wordpress.com/support/domains/site-redirect/) lists no amount.
A [WordPress.com staff reply from March 2023](https://wordpress.com/forums/topic/change-of-site-address-13/)
quoted **$13/year**; that is historical, not a current quote. Confirm currency,
tax and renewal total at checkout before buying.

The documented path is **Hosting Dashboard → select the old site → Settings →
Site redirect → Redirect URL → Redirect → checkout**. The guide says the input
uses HTTP; the destination must then upgrade to HTTPS. If the screen differs,
**confirm in your dashboard**. Site Redirect is unavailable with plugins or
hosting features activated. Old page paths must exist at the destination to avoid
broken links. [Setup and limits](https://wordpress.com/support/domains/site-redirect/).

## Before and after checkout

1. Load the existing host's skill and complete its preview and confirmed publish
   flow. Use the real public URL; verify trusted HTTPS and identifiable content.
2. Review the chosen destination and old page paths with the owner. Leave the
   purchase to the owner; no WordPress credential is needed here.
3. After setup, use `read the fetched web page` on the old homepage and a representative old
   page. Check final URLs and expected content; use `check domain HTTPS status` on the
   destination hostname. Check the destination's HTTP-to-HTTPS behavior too.
4. Report redirect, HTTPS and content separately. Unchecked or unfinished results
   are **pending**. DNS change is **not applicable** for the free address. If host
   URL eligibility or price remains unknown, say **confirm in your dashboard**.
