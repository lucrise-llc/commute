// Checks one area of the store: every module loads, and the area's rules hold.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const area = process.argv[2];
const fail = (message) => {
  console.error(`${area}: ${message}`);
  process.exit(1);
};

const modules = (folder) =>
  readdirSync(folder)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => join(folder, name));

if (area === 'routes') {
  const { routes } = await import('../src/routes.mjs');
  if (new Set(routes).size !== routes.length) fail(`duplicate routes: ${routes.join(', ')}`);
  console.log(`routes: ${routes.join(', ')}`);
} else if (area === 'docs') {
  for (const name of readdirSync('docs')) {
    if (readFileSync(join('docs', name), 'utf8').trim() === '') fail(`${name} is empty`);
  }
  console.log(`docs: ${readdirSync('docs').length} pages`);
} else if (area === 'i18n') {
  const strings = JSON.parse(readFileSync('src/i18n/en.json', 'utf8'));
  for (const [key, value] of Object.entries(strings)) {
    if (typeof value !== 'string' || value === '') fail(`${key} has no text`);
  }
  console.log(`i18n: ${Object.keys(strings).length} strings`);
} else {
  const files = modules(join('src', area));
  for (const file of files) await import(`../${file}`);
  if (area === 'cart') {
    const { subtotal } = await import('../src/cart/pricing.mjs');
    if (subtotal([{ price: 3, quantity: 2 }]) !== 6) fail('subtotal is wrong');
  }
  console.log(`${area}: ${files.length} modules load`);
}
