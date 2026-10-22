# SonarJS rule selection (4.2.0)

Reviewed from the installed package's full docs and exported rule metadata.
The executable owner is [sonarjs.config.mjs](../development/quality/sonarjs.config.mjs);
this table records the review and must be refreshed with dependency upgrades.

279 total; 216 recommended + 45 additional enabled for JavaScript; 18 convention
exclusions. TypeScript also disables `no-reference-error` (260 enabled rules).
All enabled rules are warnings. Type-dependent rules have limited or no effect
under the current syntax-only parser; these are enabled settings, not measured coverage.
ESLint metadata exposes problem/suggestion, not Sonar's full category taxonomy.
Every problem rule except the TypeScript reference checker, and every
non-recommended security hotspot, is included.
Test-specific rules remain selected in the shared policy but are inert in the
production-only Jini scope. Thresholds and operational limits: [quality-tools.md](quality-tools.md).

| Rule | Recommended | ESLint type | Needs types | Disposition / reason skipped |
| --- | --- | --- | --- | --- |
| `sonarjs/anchor-precedence` | yes | problem | yes | warn |
| `sonarjs/argument-type` | yes | suggestion | yes | warn |
| `sonarjs/arguments-order` | yes | suggestion | yes | warn |
| `sonarjs/arguments-usage` | no | suggestion | no | warn |
| `sonarjs/array-callback-without-return` | yes | problem | yes | warn |
| `sonarjs/array-constructor` | no | suggestion | no | warn |
| `sonarjs/arrow-function-convention` | no | suggestion | no | Formatting belongs to the existing formatter. |
| `sonarjs/assertions-in-test-cases` | yes | suggestion | no | warn |
| `sonarjs/assertions-in-tests` | yes | suggestion | yes | warn |
| `sonarjs/async-test-assertions` | yes | problem | no | warn |
| `sonarjs/aws-apigateway-public-api` | yes | problem | no | warn |
| `sonarjs/aws-ec2-rds-dms-public` | yes | problem | no | warn |
| `sonarjs/aws-ec2-unencrypted-ebs-volume` | yes | problem | no | warn |
| `sonarjs/aws-efs-unencrypted` | yes | problem | no | warn |
| `sonarjs/aws-iam-all-privileges` | yes | problem | no | warn |
| `sonarjs/aws-iam-all-resources-accessible` | no | problem | no | warn |
| `sonarjs/aws-iam-privilege-escalation` | yes | problem | no | warn |
| `sonarjs/aws-iam-public-access` | yes | problem | no | warn |
| `sonarjs/aws-opensearchservice-domain` | yes | problem | no | warn |
| `sonarjs/aws-rds-unencrypted-databases` | yes | problem | no | warn |
| `sonarjs/aws-restricted-ip-admin-access` | yes | problem | no | warn |
| `sonarjs/aws-s3-bucket-granted-access` | yes | problem | no | warn |
| `sonarjs/aws-s3-bucket-insecure-http` | yes | problem | no | warn |
| `sonarjs/aws-s3-bucket-public-access` | yes | problem | no | warn |
| `sonarjs/aws-s3-bucket-versioning` | yes | problem | no | warn |
| `sonarjs/aws-sagemaker-unencrypted-notebook` | yes | problem | no | warn |
| `sonarjs/aws-sns-unencrypted-topics` | yes | problem | no | warn |
| `sonarjs/aws-sqs-unencrypted-queue` | yes | problem | no | warn |
| `sonarjs/bitwise-operators` | yes | problem | yes | warn |
| `sonarjs/block-scoped-var` | yes | suggestion | no | warn |
| `sonarjs/bool-param-default` | no | suggestion | no | warn |
| `sonarjs/call-argument-line` | yes | suggestion | no | warn |
| `sonarjs/chai-determinate-assertion` | yes | suggestion | no | warn |
| `sonarjs/class-name` | yes | suggestion | no | warn |
| `sonarjs/class-prototype` | no | suggestion | yes | warn |
| `sonarjs/code-eval` | yes | problem | no | warn |
| `sonarjs/cognitive-complexity` | yes | suggestion | no | warn |
| `sonarjs/comma-or-logical-or-case` | yes | problem | no | warn |
| `sonarjs/comment-regex` | no | suggestion | no | No project-specific comment ban is defined. |
| `sonarjs/concise-regex` | yes | suggestion | yes | warn |
| `sonarjs/conditional-indentation` | no | suggestion | no | warn |
| `sonarjs/confidential-information-logging` | no | problem | no | warn |
| `sonarjs/constructor-for-side-effects` | yes | problem | no | warn |
| `sonarjs/content-length` | yes | problem | no | warn |
| `sonarjs/content-security-policy` | yes | problem | no | warn |
| `sonarjs/cookie-no-httponly` | yes | problem | no | warn |
| `sonarjs/cors` | yes | problem | no | warn |
| `sonarjs/csrf` | yes | problem | no | warn |
| `sonarjs/cyclomatic-complexity` | no | suggestion | no | Duplicates the existing core complexity rule and its strict override. |
| `sonarjs/declarations-in-global-scope` | no | suggestion | no | warn |
| `sonarjs/deprecation` | yes | suggestion | yes | warn |
| `sonarjs/destructuring-assignment-syntax` | no | suggestion | no | warn |
| `sonarjs/different-types-comparison` | yes | problem | yes | warn |
| `sonarjs/disabled-auto-escaping` | yes | problem | yes | warn |
| `sonarjs/disabled-resource-integrity` | yes | problem | yes | warn |
| `sonarjs/disabled-timeout` | yes | problem | no | warn |
| `sonarjs/dompurify-unsafe-config` | yes | problem | yes | warn |
| `sonarjs/duplicates-in-character-class` | yes | suggestion | yes | warn |
| `sonarjs/dynamically-constructed-templates` | yes | problem | no | warn |
| `sonarjs/elseif-without-else` | no | suggestion | no | warn |
| `sonarjs/empty-string-repetition` | yes | problem | yes | warn |
| `sonarjs/encryption-secure-mode` | yes | problem | no | warn |
| `sonarjs/existing-groups` | yes | problem | yes | warn |
| `sonarjs/explicit-test-skip` | yes | suggestion | no | warn |
| `sonarjs/expression-complexity` | no | suggestion | no | warn |
| `sonarjs/file-header` | no | suggestion | no | License provenance is maintained by NOTICE and source maps, not mandatory file headers. |
| `sonarjs/file-name-differ-from-class` | no | suggestion | no | Kebab-case modules and framework filenames are intentional. |
| `sonarjs/file-permissions` | yes | problem | no | warn |
| `sonarjs/file-uploads` | yes | problem | no | warn |
| `sonarjs/fixme-tag` | yes | suggestion | no | warn |
| `sonarjs/for-in` | no | problem | no | warn |
| `sonarjs/for-loop-increment-sign` | yes | problem | no | warn |
| `sonarjs/frame-ancestors` | no | problem | no | warn |
| `sonarjs/function-inside-loop` | yes | suggestion | no | warn |
| `sonarjs/function-name` | no | suggestion | no | PascalCase React components and public API names are intentional. |
| `sonarjs/function-return-type` | yes | suggestion | yes | warn |
| `sonarjs/future-reserved-words` | yes | suggestion | no | warn |
| `sonarjs/generator-without-yield` | yes | problem | no | warn |
| `sonarjs/hardcoded-secret-signatures` | yes | problem | no | warn |
| `sonarjs/hashing` | yes | problem | no | warn |
| `sonarjs/hidden-files` | no | problem | no | warn |
| `sonarjs/hooks-before-test-cases` | yes | suggestion | no | warn |
| `sonarjs/in-operator-type-error` | yes | problem | yes | warn |
| `sonarjs/inconsistent-function-call` | yes | suggestion | no | warn |
| `sonarjs/index-of-compare-to-positive-number` | yes | suggestion | yes | warn |
| `sonarjs/insecure-cookie` | yes | problem | no | warn |
| `sonarjs/insecure-jwt-token` | yes | problem | no | warn |
| `sonarjs/inverted-assertion-arguments` | yes | suggestion | no | warn |
| `sonarjs/jsx-no-leaked-render` | yes | problem | yes | warn |
| `sonarjs/label-position` | yes | suggestion | no | warn |
| `sonarjs/link-with-target-blank` | yes | problem | no | warn |
| `sonarjs/max-lines` | no | suggestion | no | Raw file size alone does not establish a maintainability defect. |
| `sonarjs/max-lines-per-function` | no | suggestion | no | Use the existing complexity budgets rather than raw line counts. |
| `sonarjs/max-switch-cases` | yes | suggestion | no | warn |
| `sonarjs/max-union-size` | no | suggestion | no | Discriminated unions legitimately exceed the default three-member limit. |
| `sonarjs/memoize-cache-key` | yes | suggestion | no | warn |
| `sonarjs/misplaced-loop-counter` | yes | suggestion | no | warn |
| `sonarjs/nested-control-flow` | no | suggestion | no | warn |
| `sonarjs/new-operator-misuse` | yes | problem | yes | warn |
| `sonarjs/no-all-duplicated-branches` | yes | problem | no | warn |
| `sonarjs/no-alphabetical-sort` | yes | problem | yes | warn |
| `sonarjs/no-angular-bypass-sanitization` | yes | problem | no | warn |
| `sonarjs/no-array-delete` | yes | suggestion | yes | warn |
| `sonarjs/no-associative-arrays` | yes | suggestion | yes | warn |
| `sonarjs/no-async-constructor` | yes | suggestion | yes | warn |
| `sonarjs/no-built-in-override` | no | problem | no | warn |
| `sonarjs/no-case-label-in-switch` | yes | suggestion | no | warn |
| `sonarjs/no-clear-text-protocols` | yes | problem | no | warn |
| `sonarjs/no-code-after-done` | yes | suggestion | no | warn |
| `sonarjs/no-collapsible-if` | no | suggestion | no | warn |
| `sonarjs/no-collection-size-mischeck` | yes | problem | yes | warn |
| `sonarjs/no-commented-code` | no | suggestion | no | warn |
| `sonarjs/no-control-regex` | yes | problem | yes | warn |
| `sonarjs/no-dead-store` | yes | suggestion | no | warn |
| `sonarjs/no-debug-commands-in-ui-tests` | yes | problem | no | warn |
| `sonarjs/no-default-utility-imports` | yes | suggestion | no | warn |
| `sonarjs/no-delete-var` | yes | problem | no | warn |
| `sonarjs/no-duplicate-in-composite` | yes | suggestion | no | warn |
| `sonarjs/no-duplicate-string` | no | suggestion | no | warn |
| `sonarjs/no-duplicate-test-title` | yes | suggestion | no | warn |
| `sonarjs/no-duplicated-branches` | yes | suggestion | no | warn |
| `sonarjs/no-element-overwrite` | yes | problem | no | warn |
| `sonarjs/no-empty-after-reluctant` | yes | suggestion | yes | warn |
| `sonarjs/no-empty-alternatives` | yes | problem | yes | warn |
| `sonarjs/no-empty-character-class` | yes | problem | yes | warn |
| `sonarjs/no-empty-collection` | yes | problem | no | warn |
| `sonarjs/no-empty-group` | yes | suggestion | yes | warn |
| `sonarjs/no-empty-test-file` | yes | suggestion | no | warn |
| `sonarjs/no-empty-test-title` | yes | suggestion | no | warn |
| `sonarjs/no-equals-in-for-termination` | yes | suggestion | no | warn |
| `sonarjs/no-exclusive-tests` | yes | problem | no | warn |
| `sonarjs/no-extra-arguments` | yes | problem | no | warn |
| `sonarjs/no-fallthrough` | yes | suggestion | no | warn |
| `sonarjs/no-fixed-wait-in-tests` | yes | suggestion | no | warn |
| `sonarjs/no-floating-point-equality` | yes | problem | no | warn |
| `sonarjs/no-for-in-iterable` | no | suggestion | yes | warn |
| `sonarjs/no-forced-browser-interaction` | yes | suggestion | no | warn |
| `sonarjs/no-function-declaration-in-block` | no | problem | no | warn |
| `sonarjs/no-global-this` | yes | suggestion | no | warn |
| `sonarjs/no-globals-shadowing` | yes | problem | no | warn |
| `sonarjs/no-gratuitous-expressions` | yes | suggestion | no | warn |
| `sonarjs/no-hardcoded-ip` | yes | suggestion | no | warn |
| `sonarjs/no-hardcoded-passwords` | yes | problem | no | warn |
| `sonarjs/no-hardcoded-secrets` | yes | problem | no | warn |
| `sonarjs/no-hook-setter-in-body` | yes | problem | no | warn |
| `sonarjs/no-identical-conditions` | yes | problem | no | warn |
| `sonarjs/no-identical-expressions` | yes | problem | no | warn |
| `sonarjs/no-identical-functions` | yes | suggestion | no | warn |
| `sonarjs/no-ignored-exceptions` | yes | suggestion | no | warn |
| `sonarjs/no-ignored-return` | yes | problem | yes | warn |
| `sonarjs/no-implicit-dependencies` | no | suggestion | no | Workspace exports and TS aliases are owned by manifests and dependency-cruiser. |
| `sonarjs/no-implicit-global` | yes | suggestion | no | warn |
| `sonarjs/no-in-misuse` | yes | suggestion | yes | warn |
| `sonarjs/no-incompatible-assertion-types` | yes | problem | yes | warn |
| `sonarjs/no-incomplete-assertions` | yes | suggestion | no | warn |
| `sonarjs/no-inconsistent-returns` | no | suggestion | yes | warn |
| `sonarjs/no-incorrect-string-concat` | no | suggestion | yes | warn |
| `sonarjs/no-internal-api-use` | yes | suggestion | no | warn |
| `sonarjs/no-interpolation-in-inline-snapshots` | yes | suggestion | no | warn |
| `sonarjs/no-intrusive-permissions` | no | problem | no | warn |
| `sonarjs/no-invalid-regexp` | yes | problem | yes | warn |
| `sonarjs/no-invariant-returns` | yes | suggestion | no | warn |
| `sonarjs/no-inverted-boolean-check` | yes | suggestion | no | warn |
| `sonarjs/no-ip-forward` | no | problem | no | warn |
| `sonarjs/no-labels` | yes | suggestion | no | warn |
| `sonarjs/no-literal-call` | yes | problem | no | warn |
| `sonarjs/no-mime-sniff` | yes | problem | no | warn |
| `sonarjs/no-misleading-array-reverse` | yes | suggestion | yes | warn |
| `sonarjs/no-misleading-character-class` | yes | problem | yes | warn |
| `sonarjs/no-mixed-completion-style` | yes | problem | no | warn |
| `sonarjs/no-mixed-content` | no | problem | no | warn |
| `sonarjs/no-nested-assignment` | yes | suggestion | no | warn |
| `sonarjs/no-nested-conditional` | yes | suggestion | no | warn |
| `sonarjs/no-nested-functions` | yes | suggestion | no | warn |
| `sonarjs/no-nested-incdec` | no | suggestion | no | warn |
| `sonarjs/no-nested-switch` | no | suggestion | no | warn |
| `sonarjs/no-nested-template-literals` | yes | suggestion | no | warn |
| `sonarjs/no-os-command-from-path` | yes | problem | no | warn |
| `sonarjs/no-parameter-reassignment` | yes | problem | no | warn |
| `sonarjs/no-primitive-wrappers` | yes | suggestion | no | warn |
| `sonarjs/no-redundant-assignments` | yes | suggestion | no | warn |
| `sonarjs/no-redundant-boolean` | yes | suggestion | no | warn |
| `sonarjs/no-redundant-jump` | yes | suggestion | no | warn |
| `sonarjs/no-redundant-optional` | yes | suggestion | yes | off — `?: T \| undefined` is intentional with exactOptionalPropertyTypes |
| `sonarjs/no-redundant-parentheses` | no | suggestion | no | warn |
| `sonarjs/no-reference-error` | no | problem | no | off on TypeScript (tsc owns references); warn on JavaScript with scoped runtime globals |
| `sonarjs/no-referrer-policy` | yes | problem | no | warn |
| `sonarjs/no-regex-spaces` | yes | suggestion | yes | warn |
| `sonarjs/no-require-or-define` | no | suggestion | yes | warn |
| `sonarjs/no-return-type-any` | no | suggestion | yes | Boundary adapters may intentionally expose dynamic values. |
| `sonarjs/no-same-argument-assert` | yes | problem | no | warn |
| `sonarjs/no-same-line-conditional` | yes | suggestion | no | warn |
| `sonarjs/no-selector-parameter` | yes | suggestion | yes | warn |
| `sonarjs/no-session-cookies-on-static-assets` | yes | problem | no | warn |
| `sonarjs/no-skipped-tests` | yes | suggestion | no | warn |
| `sonarjs/no-small-switch` | yes | suggestion | yes | warn |
| `sonarjs/no-sonar-comments` | no | suggestion | no | warn |
| `sonarjs/no-tab` | no | suggestion | no | Whitespace belongs to the formatter. |
| `sonarjs/no-table-as-layout` | yes | suggestion | no | warn |
| `sonarjs/no-trivial-assertions` | yes | suggestion | no | warn |
| `sonarjs/no-try-promise` | yes | problem | yes | warn |
| `sonarjs/no-undefined-argument` | yes | suggestion | yes | warn |
| `sonarjs/no-undefined-assignment` | no | suggestion | no | Explicit undefined is part of TypeScript optional-value contracts. |
| `sonarjs/no-unenclosed-multiline-block` | yes | suggestion | no | warn |
| `sonarjs/no-uniq-key` | yes | suggestion | no | warn |
| `sonarjs/no-unsafe-unzip` | no | suggestion | no | warn |
| `sonarjs/no-unthrown-error` | yes | problem | no | warn |
| `sonarjs/no-unused-collection` | yes | suggestion | no | warn |
| `sonarjs/no-unused-function-argument` | no | suggestion | no | Preserve the required (input, options = {}) boundary and callback contracts. |
| `sonarjs/no-unused-vars` | yes | suggestion | no | warn |
| `sonarjs/no-use-of-empty-return-value` | yes | problem | no | warn |
| `sonarjs/no-useless-catch` | yes | suggestion | no | warn |
| `sonarjs/no-useless-increment` | yes | problem | no | warn |
| `sonarjs/no-useless-intersection` | yes | problem | yes | warn |
| `sonarjs/no-useless-react-setstate` | yes | problem | no | warn |
| `sonarjs/no-variable-usage-before-declaration` | no | suggestion | no | warn |
| `sonarjs/no-weak-cipher` | yes | problem | no | warn |
| `sonarjs/no-weak-keys` | yes | problem | no | warn |
| `sonarjs/no-wildcard-import` | no | suggestion | no | Public barrel re-exports and namespace imports are established conventions. |
| `sonarjs/non-existent-operator` | yes | problem | no | warn |
| `sonarjs/non-number-in-arithmetic-expression` | no | suggestion | yes | warn |
| `sonarjs/null-dereference` | yes | problem | yes | warn |
| `sonarjs/object-alt-content` | yes | suggestion | no | warn |
| `sonarjs/operation-returning-nan` | no | suggestion | yes | warn |
| `sonarjs/os-command` | no | problem | no | warn |
| `sonarjs/parameterized-tests` | yes | suggestion | no | warn |
| `sonarjs/post-message` | yes | problem | yes | warn |
| `sonarjs/prefer-default-last` | yes | suggestion | no | warn |
| `sonarjs/prefer-immediate-return` | no | suggestion | yes | warn |
| `sonarjs/prefer-native-lodash-alternative` | yes | suggestion | no | warn |
| `sonarjs/prefer-object-literal` | no | suggestion | no | warn |
| `sonarjs/prefer-promise-shorthand` | yes | suggestion | no | warn |
| `sonarjs/prefer-read-only-props` | yes | suggestion | yes | warn |
| `sonarjs/prefer-regexp-exec` | yes | suggestion | yes | warn |
| `sonarjs/prefer-single-boolean-return` | yes | suggestion | no | warn |
| `sonarjs/prefer-specific-assertions` | yes | suggestion | no | warn |
| `sonarjs/prefer-type-guard` | yes | suggestion | no | warn |
| `sonarjs/prefer-while` | yes | suggestion | no | warn |
| `sonarjs/production-debug` | yes | problem | no | warn |
| `sonarjs/pseudo-random` | yes | problem | no | warn |
| `sonarjs/public-static-readonly` | yes | suggestion | no | warn |
| `sonarjs/publicly-writable-directories` | yes | problem | no | warn |
| `sonarjs/reduce-initial-value` | yes | problem | yes | warn |
| `sonarjs/redundant-type-aliases` | yes | suggestion | no | warn |
| `sonarjs/regex-complexity` | yes | suggestion | yes | warn |
| `sonarjs/review-blockchain-mnemonic` | yes | problem | no | warn |
| `sonarjs/session-regeneration` | yes | problem | no | warn |
| `sonarjs/shorthand-property-grouping` | no | suggestion | no | Property ordering is cosmetic and can obscure logical grouping. |
| `sonarjs/single-char-in-character-classes` | yes | suggestion | yes | warn |
| `sonarjs/single-character-alternation` | yes | suggestion | yes | warn |
| `sonarjs/slow-regex` | yes | problem | yes | warn |
| `sonarjs/sql-queries` | yes | problem | yes | warn |
| `sonarjs/stable-tests` | yes | suggestion | no | warn |
| `sonarjs/stateful-regex` | yes | problem | no | warn |
| `sonarjs/strict-transport-security` | yes | problem | no | warn |
| `sonarjs/strings-comparison` | no | suggestion | yes | warn |
| `sonarjs/super-linear-regex` | yes | suggestion | no | warn |
| `sonarjs/synchronous-suite-callback` | yes | problem | no | warn |
| `sonarjs/table-header` | yes | problem | no | warn |
| `sonarjs/table-header-reference` | yes | problem | no | warn |
| `sonarjs/test-check-exception` | yes | suggestion | no | warn |
| `sonarjs/todo-tag` | yes | suggestion | no | warn |
| `sonarjs/too-many-break-or-continue-in-loop` | no | suggestion | no | warn |
| `sonarjs/unicode-aware-regex` | no | problem | yes | warn |
| `sonarjs/unused-import` | yes | suggestion | yes | warn |
| `sonarjs/unused-named-groups` | yes | suggestion | yes | warn |
| `sonarjs/unverified-certificate` | yes | problem | no | warn |
| `sonarjs/unverified-hostname` | yes | problem | no | warn |
| `sonarjs/updated-const-var` | yes | problem | no | warn |
| `sonarjs/updated-loop-counter` | yes | suggestion | no | warn |
| `sonarjs/use-type-alias` | yes | suggestion | no | warn |
| `sonarjs/useless-string-operation` | no | problem | yes | warn |
| `sonarjs/values-not-convertible-to-numbers` | no | suggestion | yes | warn |
| `sonarjs/variable-name` | no | suggestion | no | Public protocol/property names may follow external conventions. |
| `sonarjs/void-use` | yes | suggestion | yes | warn |
| `sonarjs/weak-ssl` | yes | problem | no | warn |
| `sonarjs/web-sql-database` | no | problem | yes | warn |
| `sonarjs/x-powered-by` | yes | problem | no | warn |
| `sonarjs/xml-parser-xxe` | yes | problem | no | warn |
