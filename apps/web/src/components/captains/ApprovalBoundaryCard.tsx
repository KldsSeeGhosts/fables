import type { ComponentProps, ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * A request waiting on the user at a Captain's approval boundary: an amber hairline card with
 * the Captain it came from, a clamped preview of what it asks, and the actions that answer it.
 */
function Root({ className, ...props }: ComponentProps<"article">) {
  return (
    <article
      data-slot="approval-boundary-card"
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-card border border-approval-boundary bg-card p-3.5",
        className,
      )}
      {...props}
    />
  );
}

function Header({
  icon,
  attribution,
  className,
  children,
  ...props
}: ComponentProps<"header"> & { icon: ReactNode; attribution?: ReactNode }) {
  return (
    <header className={cn("flex min-w-0 items-center gap-2", className)} {...props}>
      <span
        aria-hidden
        className="flex size-4 shrink-0 items-center justify-center text-warning-foreground [&>svg]:size-4"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      {attribution ? (
        <span className="flex min-w-0 shrink-0 items-center gap-1.5 text-meta text-muted-foreground">
          {attribution}
        </span>
      ) : null}
    </header>
  );
}

function Title({ className, ...props }: ComponentProps<"h4">) {
  return (
    <h4 className={cn("truncate text-label text-foreground wrap-anywhere", className)} {...props} />
  );
}

function Detail({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "line-clamp-3 rounded-control surface-well px-2.5 py-2 font-mono text-meta leading-5 whitespace-pre-wrap text-muted-foreground wrap-anywhere",
        className,
      )}
      {...props}
    />
  );
}

function Actions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-1.5", className)} {...props} />
  );
}

export const ApprovalBoundaryCard = { Root, Header, Title, Detail, Actions };
