import type { ComponentProps } from "react";
import type { ResizableWidthHandlers } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";
import { useDuetShell } from "~/hooks/useDuetShell";

interface Props extends Pick<
  ComponentProps<"div">,
  "tabIndex" | "onKeyDown" | "aria-valuenow" | "aria-valuemin" | "aria-valuemax"
> {
  handlers: ResizableWidthHandlers;
  className?: string;
  label?: string;
}

export function RightPanelResizeHandle({ handlers, className, label, ...separatorProps }: Props) {
  const duet = useDuetShell();
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      {...separatorProps}
      className={cn(
        "group absolute inset-y-0 left-0 z-40 w-1 cursor-col-resize touch-none select-none any-pointer-coarse:-left-2 any-pointer-coarse:w-4",
        duet && "w-1.5 -left-[3px] any-pointer-coarse:-left-[3px] any-pointer-coarse:w-1.5",
        className,
      )}
      {...handlers}
    >
      <span
        aria-hidden
        data-duet-resize-line={duet ? "" : undefined}
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-focus-visible:bg-ring any-pointer-coarse:left-2",
          duet
            ? "left-1/2 translate-x-0 any-pointer-coarse:left-1/2"
            : "group-hover:bg-border group-active:bg-ring",
        )}
      />
    </div>
  );
}
