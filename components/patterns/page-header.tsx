import * as React from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3 pb-5">
      <div className="min-w-0">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.03em]">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-[13.5px] text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {/* whitespace-nowrap keeps individual button labels intact; flex-wrap lets the row
          itself break. Without the wrap the range picker and the page's own action formed
          one unbreakable row that ran past the right edge on a phone and scrolled the
          whole document sideways. */}
      {actions ? (
        <div className="ml-auto flex flex-wrap items-center gap-2 [&_button]:whitespace-nowrap">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
