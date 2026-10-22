  {
    name: "store",
    ownerModule: "features/plugins/store",
    // SPIKE sample Tier-3 plugin (app.ts: "SPIKE: sample Tier-3 store page") — never intended as
    // a production capability; contained in production mode until (if ever) promoted.
    classification: "experimental",
    sourceOfTruth: "sqlite (content.db, via its own never-brick dataModule seam) — durable, but the capability itself is a spike, not a supported production surface",
    readinessDependencies: ["product decision to promote this spike to a supported feature"],
    startupCriticality: "optional",
    securityDependencies: [],
    restartTestOwner: "features/plugins/store test suite",
    hasDurableAdapter: false,
    sourceHints: ["routes/site/store", "registerStoreRoutes", "bootstrapStore"],
  },