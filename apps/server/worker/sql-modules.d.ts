// Wrangler bundles each .sql file as text, as the "rules" entry in wrangler.jsonc sets. Drizzle migrations import them.
declare module '*.sql' {
  const text: string;
  export default text;
}
