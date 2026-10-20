// Deliberately short, unusable markers exercise the prefix policy without real keys.
// ruleid: no-secret-literals-in-tests
const github = 'ghp_example';
// ruleid: no-secret-literals-in-tests
const fineGrained = 'github_pat_example';
// ruleid: no-secret-literals-in-tests
const openai = 'sk-example';
// ruleid: no-secret-literals-in-tests
const aws = 'AKIAEXAMPLE';
// ruleid: no-secret-literals-in-tests
const slackBot = 'xoxb-example';
// ruleid: no-secret-literals-in-tests
const slackUser = 'xoxp-example';
// ruleid: no-secret-literals-in-tests
const embedded = 'Bearer ghp_example';

// ok: no-secret-literals-in-tests
const syntheticGithub = 'ghp_' + 'a'.repeat(36);
// ok: no-secret-literals-in-tests
const syntheticAws = 'AKIA' + 'A'.repeat(16);
// ok: no-secret-literals-in-tests
const syntheticOpenai = 'sk-' + 'b'.repeat(40);
// ok: no-secret-literals-in-tests
const ordinary = 'provider refused the request';
