import type { ReactNode } from "react";

import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { cn } from "~/lib/utils";

export function WorkingStatusShine({
  className,
  children,
}: {
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <span ref={observeVisibleAnimation} className={cn("working-status-shine", className)}>
      {children}
    </span>
  );
}
