/**
 * The site's content, as Schema.org items.
 *
 * This file is the part a real consumer owns. Tovu would generate these from its articles and
 * products table; a docs site would generate them from its pages. The engine side must never
 * know what an "article" means to a particular product — it only sees `SchemaOrgItem`.
 *
 * Schema.org itself is generic web vocabulary rather than product vocabulary, which is why it is
 * admissible as a shared shape at all.
 */

/** The subset of Schema.org this demo uses. Real items carry more; nothing here requires it. */
export interface SchemaOrgItem {
  readonly '@type': 'Article' | 'Product' | 'FAQPage' | 'WebPage';
  readonly '@id': string;
  readonly name: string;
  readonly description: string;
  /** Full text used for retrieval. Not returned to the caller. */
  readonly text: string;
  readonly url: string;
  readonly keywords?: readonly string[];
  readonly datePublished?: string;
}

export const SITE_ITEMS: readonly SchemaOrgItem[] = [
  {
    '@type': 'Article',
    '@id': 'urn:sunday-list',
    name: 'Sunday list',
    description: 'A small weekly task board for keeping the week light.',
    text: `Sunday list. Keep the week light. Pick three things that matter. The board holds
      tasks you can check off: make coffee slowly, water the window plants, sketch one new idea.
      Add a new task with the input at the top. A counter shows how many things are still left.`,
    url: '/sample-preview/starter-site/index.html',
    keywords: ['tasks', 'todo', 'weekly', 'checklist'],
    datePublished: '2026-07-20',
  },
  {
    '@type': 'Article',
    '@id': 'urn:notes',
    name: 'Notes',
    description: 'Longer thoughts that did not fit on the task list.',
    text: `Notes. Longer thoughts that did not fit on the list. Watering schedule: the window
      plants want water on Sundays, the others can wait. On making coffee slowly: grind, then
      wait. The waiting is the point. Write a new note with a short title.`,
    url: '/sample-preview/starter-site/notes.html',
    keywords: ['notes', 'writing', 'plants', 'coffee'],
    datePublished: '2026-07-25',
  },
  {
    '@type': 'FAQPage',
    '@id': 'urn:faq-watering',
    name: 'How often should I water the window plants?',
    description: 'Watering guidance for the window plants.',
    text: `The window plants want water once a week, on Sundays. Other plants in the house can
      wait longer. Overwatering is the more common mistake. If the soil is damp an inch down,
      skip the week.`,
    url: '/sample-preview/starter-site/notes.html#watering',
    keywords: ['plants', 'water', 'watering', 'schedule', 'care'],
  },
  {
    '@type': 'Product',
    '@id': 'urn:product-watering-can',
    name: 'Small brass watering can',
    description: 'A one-litre watering can with a long spout, for window plants.',
    text: `Small brass watering can. One litre. The long spout reaches the back of a window box
      without disturbing the leaves. Suited to indoor plants and herbs.`,
    url: '/shop/watering-can',
    keywords: ['watering can', 'brass', 'plants', 'tools', 'indoor'],
  },
  {
    '@type': 'Article',
    '@id': 'urn:coffee-method',
    name: 'A slower coffee method',
    description: 'Grinding, blooming, and why waiting matters.',
    text: `A slower coffee method. Grind just before brewing. Bloom the grounds with a little
      water and wait thirty seconds before pouring the rest. The waiting is not a delay, it is
      the part that makes the cup taste like anything.`,
    url: '/blog/slower-coffee',
    keywords: ['coffee', 'brewing', 'method', 'grind'],
  },
];
