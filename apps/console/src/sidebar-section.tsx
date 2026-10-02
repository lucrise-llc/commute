type SidebarSectionProps = {
  title: string;
  children: React.ReactNode;
};

// One labeled fact in the right sidebar of a Git host page.
export function SidebarSection({ title, children }: SidebarSectionProps): React.JSX.Element {
  return (
    <section className="border-b border-kumo-hairline py-3 first:pt-0">
      <h3 className="mb-1.5 text-xs font-semibold text-kumo-subtle">{title}</h3>
      {children}
    </section>
  );
}
