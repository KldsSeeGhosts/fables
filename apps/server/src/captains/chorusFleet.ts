import { ThreadId, type OrchestrationV2LinkedSender } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as PeerLinks from "../peer/PeerLinks.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";

export const activeChorusTool = "chorus_active";
export const ActiveChorusResult = Schema.Struct({ active: Schema.Boolean });

export const chorusHomeTool = "chorus_home";
export const ChorusHomeResult = Schema.Struct({
  home: Schema.Boolean,
  threadId: Schema.NullOr(ThreadId),
});

export const chorusActivityTool = "chorus_machine_activity";
export const CHORUS_DUET_LIMIT = 16;
export const BRIEF_OPEN_ITEM_LIMIT = 8;

const bounded = (length: number) => Schema.String.check(Schema.isMaxLength(length));
export const ChorusMachineActivity = Schema.Struct({
  label: bounded(120),
  duets: Schema.Array(
    Schema.Struct({
      name: bounded(120),
      digestNew: bounded(700),
      activeTasks: Schema.Array(
        Schema.Struct({
          title: bounded(100),
          status: bounded(40),
          progress: Schema.optional(bounded(120)),
        }),
      ).check(Schema.isMaxLength(BRIEF_OPEN_ITEM_LIMIT)),
      pendingRequests: Schema.Array(
        Schema.Struct({ kind: bounded(40), detail: Schema.optional(bounded(140)) }),
      ).check(Schema.isMaxLength(BRIEF_OPEN_ITEM_LIMIT)),
    }),
  ).check(Schema.isMaxLength(CHORUS_DUET_LIMIT)),
  omittedDuets: Schema.optionalKey(Schema.Boolean),
  unreachableReason: Schema.optionalKey(bounded(200)),
});
export type ChorusMachineActivity = typeof ChorusMachineActivity.Type;

export const makeReadChorusFleet = Effect.gen(function* () {
  const links = yield* Effect.serviceOption(PeerLinks.PeerLinks);
  const peers = yield* Effect.serviceOption(PeerMcpClient.PeerMcpClient);
  return Effect.fn("ChorusFleet.read")(function* <S extends Schema.Decoder<unknown>>(input: {
    readonly tool: string;
    readonly success: S;
    readonly limit?: number;
    readonly sender?: OrchestrationV2LinkedSender;
  }) {
    if (Option.isNone(links) || Option.isNone(peers) || !(yield* links.value.enabled)) {
      return { machines: [], omitted: false };
    }
    const client = peers.value;
    const names = yield* links.value.names(input.limit === undefined ? -1 : input.limit + 1);
    const selected = input.limit === undefined ? names : names.slice(0, input.limit);
    const machines = yield* Effect.forEach(
      selected,
      (machine) =>
        client
          .call({
            tool: input.tool,
            success: input.success,
            environmentId: machine.environmentId,
            arguments: {},
            limits: { runtimeMode: "approval-required", interactionMode: "default" },
            ...(input.sender === undefined
              ? {}
              : { sender: input.sender, senderCaptainKind: "chorus" }),
          })
          .pipe(
            Effect.timeout("5 seconds"),
            Effect.interruptible,
            Effect.result,
            Effect.map((reply) => ({ ...machine, reply })),
          ),
      { concurrency: 8 },
    );
    return { machines, omitted: names.length > selected.length };
  });
});
