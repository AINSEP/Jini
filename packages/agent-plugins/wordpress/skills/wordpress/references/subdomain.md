# Connect an owned subdomain

Use this path for a domain the owner controls. WordPress.com supports pointing an
owned subdomain at an external host. A free WordPress.com address uses the
[redirect guide](free-site-redirect.md) instead.
[WordPress.com guide](https://wordpress.com/support/domains/connect-a-subdomain-to-an-external-site/).

## Seven steps

1. Identify the owned root domain, desired full subdomain, authoritative DNS
   provider, and installed host or existing deployment. DNS is managed where the
   nameservers point, which may differ from the registrar.
   [DNS ownership](https://wordpress.com/support/domains/custom-dns/).
2. Load the selected host's skill. Reuse its saved credential, connection card,
   publish preview and confirmed publish flow. Capture the actual public URL and
   a distinctive visible phrase from this revision for the content check.
3. Add the requested subdomain to the actual project in the host's console
   **before adding DNS**. Use the provider procedure below. The installed Netlify,
   Vercel and GitHub Pages targets have no `customDomain` option. Cloudflare's
   installed option expects a full active DNS zone and manages apex plus `www`;
   use its console for this external-DNS subdomain path.
4. Copy the exact required record from that project's domain settings. Include
   any ownership-verification record. Never derive a destination from the owner's
   name, copy a documentation example, or guess a shared CNAME.
5. Pass the actual hostname and provider records as `requirements` to `preview DNS changes`,
   then `DNS setup instructions`. Requirements use `purpose: "site"`, or `"tls"` for
   certificate requirements, with `records` containing `type`, full `name`, `value`
   and the supplied `ttl` when present. Resolve blockers before entry. Show each
   row's type, full name, registrar Host/Name, value and TTL. These tools plan;
   the owner enters the records. Preserve root-domain, mail and unrelated records.
6. Once entered, call `verify DNS records` with the same hostname and requirements. It
   saves propagation tracking and checks authoritative nameservers; it never
   edits DNS. Call `check domain HTTPS status` with the subdomain as `domain`, then
   `read the fetched web page` with its HTTPS URL. Check the final URL and distinctive phrase,
   plus a representative page and stylesheet asset. A generic 200 or shared host IP is
   insufficient. If a tool is unavailable, leave its check pending.
7. Report **DNS**, **HTTPS** and **content** separately, each with observed
   evidence. Unfinished work is **pending**; retain mismatch or invalid results
   and explain the next action. Claim live only after the intended site is
   reachable over trusted HTTPS. Keep the deployment attached to the selected host.

## Where to get the record

These are record sources, not values to paste. Use the real project's settings.

| Host | Attach first, then obtain the record |
|---|---|
| Cloudflare Pages | Project → Custom domains → add the subdomain. Use that project's actual `.pages.dev` hostname as the CNAME destination. External DNS is supported for subdomains. [Cloudflare](https://developers.cloudflare.com/pages/configuration/custom-domains/) |
| Netlify | Add the domain to the site, then use the supplied CNAME, normally the site's actual `.netlify.app` hostname. High-Performance Edge uses its assigned destination. [Netlify](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/) |
| Vercel | Project → Settings → Domains → add the subdomain. Copy its project-specific CNAME and any requested verification record. [Vercel](https://vercel.com/docs/domains/working-with-domains/add-a-domain) |
| GitHub Pages | Repository → Settings → Pages → Custom domain → Save. The CNAME points to the actual user/organization's `.github.io` hostname, excluding the repository name. [GitHub](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) |

**GitHub Pages limitation:** when the installed target exports links under
`/<repo>`, a custom domain does not fix that export prefix. Do not promise
a working custom-domain site while it persists; offer another installed host.

## Enter DNS at WordPress.com

When WordPress.com is authoritative: **Hosting Dashboard → Domains → selected
root domain → Settings → DNS records → Add record**. Choose the provider's type,
enter the relative subdomain in **Name**, and its supplied destination in
**Points to**. Use the supplied TTL, or the dashboard default when none is given.
For another authoritative provider, use its corresponding form; confirm whether
Host/Name expects a relative or full name. Do not move nameservers for this guide.
[WordPress.com steps](https://wordpress.com/support/domains/connect-a-subdomain-to-an-external-site/),
[authoritative DNS](https://wordpress.com/support/domains/custom-dns/).
