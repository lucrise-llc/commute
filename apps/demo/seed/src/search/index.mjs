export function tokenize(text) {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}
