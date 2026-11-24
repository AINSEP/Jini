import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** domain-dns registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  "domain_check_dns": {
    search: {
      keywords: "domain DNS custom points pointing host hosting deploy target expected compare mismatch apex www publish destination",
      queries: [
        "Does my custom domain point at the right host?",
        "Compare my domain DNS against the hosting address.",
        "Is www pointing to the deploy target?",
        "Check whether the apex DNS matches my publish destination.",
        "Why is the domain pointing at a different hosting IP?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "domain_lookup_dns": {
    search: {
      keywords: "domain DNS dig lookup resolve records A AAAA CNAME MX TXT NS nameservers propagation apex www IP mail verification ACME challenge _acme-challenge DKIM DMARC _dmarc _domainkey",
      queries: [
        "What DNS records does my domain have?",
        "Show the A and AAAA IP addresses for the apex and www.",
        "Look up the MX and TXT records for my domain.",
        "Which nameservers handle this domain?",
        "Has the DNS change propagated yet?",
        "Look up ACME challenge CNAME and DKIM or DMARC TXT records.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "domain_tls_status": {
    search: {
      keywords: "domain TLS SSL HTTPS certificate status valid trust trusted expired hostname mismatch security",
      queries: [
        "Is the TLS certificate for my domain valid?",
        "Check my SSL certificate status.",
        "Is HTTPS trusted on this domain?",
        "Has my site's certificate expired?",
        "Does the certificate match the domain hostname?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "dns_plan": {
    search: {
      keywords: "dns plan records changes needed required provider zone delegation nameserver registrar spf dkim dmarc mx verification connect custom domain set up",
      queries: [
        "What DNS changes does my domain need?",
        "Plan the DNS records for connecting my custom domain.",
        "Which records must I add for my mail provider's SPF, DKIM and DMARC?",
        "Is my domain delegated to the right nameservers?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "dns_instructions": {
    search: {
      keywords: "dns instructions steps rows copy paste enter add records registrar dns host manual table how to set up",
      queries: [
        "Give me the DNS records to enter at my registrar.",
        "What exactly do I type into my DNS host?",
        "Show copyable DNS rows for my domain setup.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "dns_verify": {
    search: {
      keywords: "dns verify verification track tracking records entered done authoritative nameservers status propagated required records binding",
      queries: [
        "I added the DNS records, are they live yet?",
        "Verify the required DNS records on the authoritative nameservers.",
        "Track whether my domain's records have propagated.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "mail_dns_status": {
    search: {
      keywords: "email mail dns sender domain records spf dkim dmarc mx verified verification status missing mismatch check provider sending domain",
      queries: [
        "Are my email DNS records set up correctly?",
        "Which SPF, DKIM or DMARC records are missing for my sender domain?",
        "Has my mail provider verified my sending domain?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "mail_dns_verify": {
    search: {
      keywords: "email mail dns sender domain records verify recheck check again track propagation entered spf dkim dmarc",
      queries: [
        "I added the email DNS records, check them again.",
        "Start tracking my sender domain's mail records until they propagate.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
