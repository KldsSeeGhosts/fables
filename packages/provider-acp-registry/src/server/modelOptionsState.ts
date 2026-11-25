import {
  ProviderOptionDescriptor,
  ServerProvider,
  type ProviderDriverKind,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import type { AcpRegistryLiveConfiguration } from "./probe.ts";

const ObservedOptions = Schema.Struct({
  options: Schema.Array(ProviderOptionDescriptor),
  complete: Schema.Boolean,
});
const stateJson = Schema.fromJsonString(
  Schema.Struct({
    binding: Schema.String,
    models: Schema.Array(Schema.Tuple([Schema.String, ObservedOptions])),
    lastAttemptedModelId: Schema.optionalKey(Schema.String),
  }),
);
const decodeState = Schema.decodeUnknownEffect(stateJson);
const encodeState = Schema.encodeEffect(stateJson);
const decodeLegacySnapshot = Schema.decodeUnknownEffect(Schema.fromJsonString(ServerProvider));

export type AcpRegistryModelOptions = ReadonlyMap<string, typeof ObservedOptions.Type>;

export const makeAcpRegistryModelOptionsState = Effect.fn("AcpRegistryModelOptionsState.make")(
  function* (input: {
    readonly cacheDir: string;
    readonly instanceId: ProviderInstanceId;
    readonly driverKind: ProviderDriverKind;
    readonly binding: string;
    readonly bindingChanged: boolean;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const filePath = path.join(
      input.cacheDir,
      "acp-registry",
      "model-options",
      `${input.instanceId}.json`,
    );
    const saved = yield* fs.readFileString(filePath).pipe(
      Effect.flatMap(decodeState),
      Effect.orElseSucceed(() => undefined),
    );
    const legacy =
      saved === undefined && !input.bindingChanged
        ? yield* fs.readFileString(path.join(input.cacheDir, `${input.instanceId}.json`)).pipe(
            Effect.flatMap(decodeLegacySnapshot),
            Effect.orElseSucceed(() => undefined),
          )
        : undefined;
    const legacyModels =
      legacy?.instanceId === input.instanceId && legacy.driver === input.driverKind
        ? legacy.models.filter((model) => !model.isCustom)
        : [];
    const state = yield* Ref.make({
      models: new Map(saved?.binding === input.binding ? saved.models : undefined),
      lastAttemptedModelId:
        saved?.binding === input.binding ? saved.lastAttemptedModelId : undefined,
      needsSave: false,
    });

    const observe = Effect.fn("AcpRegistryModelOptionsState.observe")(function* (
      configuration: AcpRegistryLiveConfiguration,
      attemptedModelId?: string,
    ) {
      const previous = yield* Ref.get(state);
      const models = new Map(previous.models);
      // Older snapshots combined shared and scoped options. Recover descriptors
      // with explicit reasoning roles or IDs the agent now identifies as scoped.
      const scopedIds = new Set(configuration.modelOptionIds);
      for (const model of configuration.models) {
        for (const option of model.configOptions ?? []) scopedIds.add(option.id);
      }
      for (const model of legacyModels) {
        if (models.has(model.slug)) continue;
        const options = model.capabilities?.optionDescriptors?.filter(
          (option) =>
            scopedIds.has(option.id) || (option.type === "select" && option.role === "reasoning"),
        );
        if (options?.length) models.set(model.slug, { options, complete: false });
      }
      for (const model of configuration.models) {
        if (model.configOptions !== undefined) {
          models.set(model.id, { options: model.configOptions, complete: true });
        } else if (model.reasoningEffort !== undefined) {
          const existing = models.get(model.id);
          models.set(model.id, {
            options: [
              ...(existing?.options ?? []).filter(
                (option) => option.type !== "select" || option.role !== "reasoning",
              ),
              ...(model.reasoningEffort === null ? [] : [model.reasoningEffort]),
            ],
            complete: existing?.complete ?? false,
          });
        }
      }
      const lastAttemptedModelId = attemptedModelId ?? previous.lastAttemptedModelId;
      if (
        !previous.needsSave &&
        lastAttemptedModelId === previous.lastAttemptedModelId &&
        Equal.equals(models, previous.models)
      ) {
        return previous.models;
      }
      const persisted = yield* encodeState({
        binding: input.binding,
        models: [...models],
        ...(lastAttemptedModelId === undefined ? {} : { lastAttemptedModelId }),
      }).pipe(
        Effect.flatMap((contents) => writeFileStringAtomically({ filePath, contents })),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.tapError(() => Effect.logWarning("Could not save discovered ACP model options.")),
        Effect.option,
      );
      yield* Ref.set(state, {
        models,
        lastAttemptedModelId,
        needsSave: Option.isNone(persisted),
      });
      return models;
    }, Effect.uninterruptible);
    return { get: Ref.get(state), observe };
  },
);
