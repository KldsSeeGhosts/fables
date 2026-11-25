import { isCaptainThreadId, type ThreadId } from "@t3tools/contracts";
import type { DuetToolCallVisibility, ToolCallVisibility } from "@t3tools/contracts/settings";

/** Which tool-call visibility setting applies to a thread. */
export function resolveThreadToolCallVisibility(input: {
  readonly threadId: ThreadId;
  readonly toolCallVisibility: ToolCallVisibility;
  readonly duetToolCallVisibility?: DuetToolCallVisibility | undefined;
}): ToolCallVisibility {
  if (
    isCaptainThreadId(input.threadId) &&
    input.duetToolCallVisibility !== undefined &&
    input.duetToolCallVisibility !== "inherit"
  ) {
    return input.duetToolCallVisibility;
  }
  return input.toolCallVisibility;
}
