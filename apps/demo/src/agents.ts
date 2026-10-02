// The 20 scripted agents of the demo, in the order they start. The order sets the change numbers, so alice-3 lands
// before bob-2 and alice-2 before alice-5 on every run.

export type Owner = 'alice' | 'bob';

export type Edit =
  | {
      kind: 'write';
      path: string;
      text: string;
    }
  | {
      kind: 'replace';
      path: string;
      find: string;
      text: string;
    }
  | {
      kind: 'append';
      path: string;
      text: string;
    };

export type Agent = {
  name: string;
  owner: Owner;
  intent: string;
  edit: Edit;
};

export const AGENTS: Agent[] = [
  {
    name: 'alice-1',
    owner: 'alice',
    intent: 'Cap the cart badge at 99',
    edit: {
      kind: 'replace',
      path: 'src/cart/badge.mjs',
      find: "  return count === 0 ? '' : String(count);",
      text: "  if (count === 0) {\n    return '';\n  }\n  return count > 99 ? '99+' : String(count);"
    }
  },
  {
    name: 'alice-2',
    owner: 'alice',
    intent: 'Add a member discount to cart pricing',
    edit: {
      kind: 'append',
      path: 'src/cart/pricing.mjs',
      text: '\nexport function memberDiscount(total) {\n  return Math.round(total * 0.9);\n}\n'
    }
  },
  {
    name: 'alice-3',
    owner: 'alice',
    intent: 'Add the search page',
    edit: { kind: 'replace', path: 'src/routes.mjs', find: "  'cart',\n", text: "  'cart',\n  'search',\n" }
  },
  {
    name: 'bob-1',
    owner: 'bob',
    intent: 'Note the free shipping threshold in the API docs',
    edit: { kind: 'append', path: 'docs/api.md', text: '\nOrders of 50 or more ship free.\n' }
  },
  {
    name: 'bob-2',
    owner: 'bob',
    intent: 'Add the orders page',
    edit: { kind: 'replace', path: 'src/routes.mjs', find: "  'cart',\n", text: "  'cart',\n  'orders',\n" }
  },
  {
    name: 'alice-4',
    owner: 'alice',
    intent: 'Rank search suggestions by length',
    edit: {
      kind: 'replace',
      path: 'src/search/suggest.mjs',
      find: '.slice(0, 5)',
      text: '.sort((left, right) => left.length - right.length).slice(0, 5)'
    }
  },
  {
    name: 'bob-3',
    owner: 'bob',
    intent: 'Add a hoodie to the catalog',
    edit: {
      kind: 'write',
      path: 'src/catalog/hoodie.mjs',
      text: "export const hoodie = { id: 'hoodie', name: 'Hoodie', price: 45 };\n"
    }
  },
  {
    name: 'alice-5',
    owner: 'alice',
    intent: 'Add a gift wrap fee to cart pricing',
    edit: {
      kind: 'append',
      path: 'src/cart/pricing.mjs',
      text: '\nexport function giftWrap(total) {\n  return total + 4;\n}\n'
    }
  },
  {
    name: 'bob-4',
    owner: 'bob',
    intent: 'Reword the offline error',
    edit: {
      kind: 'replace',
      path: 'src/i18n/en.json',
      find: '"errors.offline": "You are offline"',
      text: '"errors.offline": "No connection. Try again soon."'
    }
  },
  {
    name: 'alice-6',
    owner: 'alice',
    intent: 'Add a scarf to the catalog',
    edit: {
      kind: 'replace',
      path: 'src/catalog/products.mjs',
      find: "  { id: 'cap', name: 'Cap', price: 22 },\n",
      text: "  { id: 'cap', name: 'Cap', price: 22 },\n  { id: 'scarf', name: 'Scarf', price: 16 },\n"
    }
  },
  {
    name: 'bob-5',
    owner: 'bob',
    intent: 'Add a price formatter to the cart',
    edit: {
      kind: 'write',
      path: 'src/cart/format.mjs',
      text: 'export function formatPrice(amount) {\n  return `$${amount.toFixed(2)}`;\n}\n'
    }
  },
  {
    name: 'alice-7',
    owner: 'alice',
    intent: 'Rename the cart title',
    edit: {
      kind: 'replace',
      path: 'src/i18n/en.json',
      find: '"cart.title": "Your cart"',
      text: '"cart.title": "Shopping cart"'
    }
  },
  {
    name: 'bob-6',
    owner: 'bob',
    intent: 'Cache search tokens',
    edit: {
      kind: 'write',
      path: 'src/search/cache.mjs',
      text: "import { tokenize } from './index.mjs';\n\nconst cache = new Map();\n\nexport function cachedTokens(text) {\n  if (!cache.has(text)) {\n    cache.set(text, tokenize(text));\n  }\n  return cache.get(text);\n}\n"
    }
  },
  {
    name: 'alice-8',
    owner: 'alice',
    intent: 'Document the checkout flow',
    edit: {
      kind: 'write',
      path: 'docs/checkout.md',
      text: '# Checkout\n\nThe cart page shows the subtotal, shipping, and the total. Check out sends the order.\n'
    }
  },
  {
    name: 'bob-7',
    owner: 'bob',
    intent: 'Write the account page guide',
    edit: {
      kind: 'write',
      path: 'docs/account.md',
      text: '# Account\n\nThe account page shows past orders and the sign-out button.\n'
    }
  },
  {
    name: 'alice-9',
    owner: 'alice',
    intent: 'Add stop words to search',
    edit: {
      kind: 'write',
      path: 'src/search/stopwords.mjs',
      text: "export const STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'of']);\n"
    }
  },
  {
    name: 'bob-8',
    owner: 'bob',
    intent: 'Mark sale prices in the catalog',
    edit: {
      kind: 'write',
      path: 'src/catalog/sale.mjs',
      text: 'export function salePrice(price, percent) {\n  return Math.round(price * (100 - percent)) / 100;\n}\n'
    }
  },
  {
    name: 'alice-10',
    owner: 'alice',
    intent: 'Explain the checks in the setup guide',
    edit: {
      kind: 'append',
      path: 'docs/setup.md',
      text: '\nEach area has a check. Commute runs a check again only when a folder it reads changes.\n'
    }
  },
  {
    name: 'bob-9',
    owner: 'bob',
    intent: 'Add French cart strings',
    edit: {
      kind: 'write',
      path: 'src/i18n/fr.json',
      text: '{\n  "cart.title": "Votre panier",\n  "cart.empty": "Votre panier est vide"\n}\n'
    }
  },
  {
    name: 'bob-10',
    owner: 'bob',
    intent: 'Document the search index',
    edit: {
      kind: 'write',
      path: 'docs/search.md',
      text: '# Search\n\nThe index splits names into lowercase words. Suggestions start with the query.\n'
    }
  }
];

// The landing plan: each batch lists agents and the person who approves it. A batch runs once all of its changes are
// ready. Batch 1 leaves out the first change of each conflicting pair, so the conflict act shows one landing at a time.
export const BATCHES: Array<{
  approver: Owner;
  agents: string[];
}> = [
  {
    approver: 'bob',
    agents: AGENTS.map((agent) => agent.name).filter(
      (name) => !['alice-2', 'alice-3', 'alice-5', 'bob-2'].includes(name)
    )
  },
  { approver: 'alice', agents: ['alice-3'] },
  { approver: 'bob', agents: ['alice-2', 'bob-2'] },
  { approver: 'alice', agents: ['alice-5'] }
];
