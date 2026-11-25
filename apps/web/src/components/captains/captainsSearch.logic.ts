import { CaptainId, EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const decodeEnvironmentId = Schema.decodeUnknownOption(EnvironmentId);
const decodeCaptainId = Schema.decodeUnknownOption(CaptainId);

export interface CaptainsSearch {
  readonly env?: EnvironmentId;
  readonly captain?: CaptainId;
  readonly view?: "brief" | "tasks" | "docs" | "memory";
}

export function captainsSearchFromUrl(raw: Record<string, unknown>): CaptainsSearch {
  const env = Option.getOrUndefined(decodeEnvironmentId(raw.env));
  const captain = Option.getOrUndefined(decodeCaptainId(raw.captain));
  const view = raw.view;
  return {
    ...(env !== undefined ? { env } : {}),
    ...(captain !== undefined ? { captain } : {}),
    ...(view === "brief" || view === "tasks" || view === "docs" || view === "memory"
      ? { view }
      : {}),
  };
}
