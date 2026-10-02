import { Children } from 'react';
import { cn, LayerCard } from '@cloudflare/kumo';

type BoxProps = {
  header?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
};

// The bordered list of a Git host: an optional header strip, then rows with a hairline between them. A box without
// rows shows its header alone.
export function Box({ header, className, children }: BoxProps): React.JSX.Element {
  if (header === undefined) {
    return <LayerCard className={cn('divide-y divide-kumo-hairline', className)}>{children}</LayerCard>;
  }
  return (
    <LayerCard className={className}>
      <LayerCard.Secondary className="text-kumo-default">{header}</LayerCard.Secondary>
      {Children.toArray(children).length === 0 ? null : (
        <LayerCard.Primary className="gap-0 divide-y divide-kumo-hairline p-0">{children}</LayerCard.Primary>
      )}
    </LayerCard>
  );
}

type BoxRowProps = {
  className?: string;
  children: React.ReactNode;
};

export function BoxRow({ className, children }: BoxRowProps): React.JSX.Element {
  return <div className={cn('flex items-start gap-2.5 px-4 py-3', className)}>{children}</div>;
}
