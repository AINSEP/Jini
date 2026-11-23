import { expect, it } from 'vitest';
import { getDatabaseAgentToolCatalog, SITE_DATABASE_MESSAGES, SITE_TRANSFER_MESSAGES as messages } from '../../tools/index.js';

/** @file The "this site" wording profile for the database and transfer tools' messages. */

it('the plan description names the real default schema and per-site prefix', () => {
  const text = messages.plan({ naming: { defaultSchema: 'site', schemaPrefix: 'site_' } });
  expect(text).toMatch(/'site' for the first site copied there, 'site_<site name>' for any other/);
  expect(text).toMatch(/^Plans a COPY of this site's data into a Postgres database/);
});

it('the parameterised refusals and confirmations speak of this site and name what is missing', () => {
  expect(messages.privateAreasTaken({ where: 'db.example.com/app' })).toBe('every private area this site could use in db.example.com/app already holds other data. Nothing will be overwritten.');
  expect(messages.destinationSaved({ database: 'app', host: 'db.example.com' })).toBe("Copies of this site's data will go to app on db.example.com.");
  expect(messages.missingSourceTable({ table: 'entries' })).toBe("this site's database has no 'entries' table");
  expect(messages.missingSourceColumn({ table: 'entries', column: 'slug' })).toBe("this site's database has no 'entries.slug' column");
});

it('the site catalog keeps every tool identity and permission and swaps only the wording', () => {
  const neutral = getDatabaseAgentToolCatalog();
  const site = getDatabaseAgentToolCatalog({}, { messages: SITE_DATABASE_MESSAGES });
  expect(site.map((tool) => [tool.name, tool.authorization, tool.sideEffects])).toEqual(neutral.map((tool) => [tool.name, tool.authorization, tool.sideEffects]));
  expect(site.find((tool) => tool.name === 'database_get_health')?.description).toBe(SITE_DATABASE_MESSAGES.databaseHealth);
  expect(SITE_DATABASE_MESSAGES.databaseHealth).toMatch(/this site's database health/);
});
