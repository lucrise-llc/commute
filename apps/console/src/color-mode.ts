const DARK_QUERY = '(prefers-color-scheme: dark)';

// Kumo switches its tokens to dark on the data-mode attribute of the document, not on the system setting. The console
// sets the attribute from the system setting and keeps it in step when the setting changes.
export function followSystemColorMode(): void {
  const query = matchMedia(DARK_QUERY);
  const apply = (): void => {
    document.documentElement.dataset['mode'] = query.matches ? 'dark' : 'light';
  };
  apply();
  query.addEventListener('change', apply);
}
