import type { ReactNode } from "react";

import { useDuetShell } from "~/hooks/useDuetShell";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { cn } from "~/lib/utils";

/** "Working" text with the Duet theme's highlight sweep; other themes keep plain text. */
export function WorkingStatusShine({
  className,
  children,
}: {
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  const duet = useDuetShell();
  if (!duet) return <span className={className}>{children}</span>;
  return (
    <span ref={observeVisibleAnimation} className={cn("working-status-shine", className)}>
      {children}
    </span>
  );
}
