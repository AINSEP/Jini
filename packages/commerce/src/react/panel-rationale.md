  {
    id: "payments",
    // Moved out of People (see git history for the prior comment on this panel, which correctly
    // anticipated exactly this reshuffle once there was something to group with). This entry is
    // provider configuration — the `lipay` plugin's Stripe/PayPal integrations — not the billing
    // data itself; the `member_tiers`/`member_subscriptions` tables it charges against are their
    // own `subscriptions` entry below. Commerce groups the two together with Orders and Products
    // because all four are the same business function (running a storefront), which is a
    // meaningfully different concern from People's identity/access management.
    render: () => <Payments />,
    nav: {
      label: "Payments",
      group: "Commerce",
      soon: true,
      soonPreviewable: true,
      icon: '<rect x="2" y="4" width="14" height="10" rx="1.5"/><path d="M2 7.5h14"/><path d="M4.5 11h3"/>',
    },
  },
