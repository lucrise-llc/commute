import { Loader } from '@cloudflare/kumo';

type LoadingProps = {
  text: string;
};

// A spinner and what it waits for, while the first query of a page loads.
export function Loading({ text }: LoadingProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-kumo-subtle">
      <Loader size="sm" />
      {text}
    </div>
  );
}
