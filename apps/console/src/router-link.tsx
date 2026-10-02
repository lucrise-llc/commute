import type { LinkComponentProps } from '@cloudflare/kumo';

import { forwardRef } from 'react';
import { Link } from 'react-router';

// The link that Kumo's Link and Breadcrumbs render, so that they navigate inside the console without a page load.
// Breadcrumbs passes its target as `to`, and Link passes it as `href`.
export const RouterLink = forwardRef<HTMLAnchorElement, LinkComponentProps>(
  // oxlint-disable-next-line max-params -- framework signature
  function RouterLink({ href, to, ...props }, ref) {
    return <Link ref={ref} to={href ?? to ?? ''} {...props} />;
  }
);
