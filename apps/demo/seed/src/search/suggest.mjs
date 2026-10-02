export function suggest(query, names) {
  return names.filter((name) => name.toLowerCase().startsWith(query.toLowerCase())).slice(0, 5);
}
