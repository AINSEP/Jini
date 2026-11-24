---
"@jini-ai/admin": minor
"@jini-ai/user-management": minor
---

w3-users-sec wave 2/3: Roles screen, Login/OwnerRecoverySignIn, Authentication screen and the users dictionary move to `@jini-ai/admin` (`./roles/*`, `./screens/auth/*`, `./screens/authentication/*`, `./users/users-i18n`) with host collaborators injected (required hooks, feature-owned slots, product name via K3); `@jini-ai/user-management` gains the identity api-key/purge/reset modules, `createTrashUserService`, owner auth client factories and the localized Users panel.
