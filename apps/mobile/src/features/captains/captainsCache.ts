import { Captain, type EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";

import * as Runtime from "../../lib/runtime";
import * as MobileDatabase from "../../persistence/mobile-database";

const CACHE_KIND = "captains";
const CACHE_KEY = "list";
const CACHE_SCHEMA_VERSION = 1;

const StoredCaptains = Schema.fromJsonString(
  Schema.Struct({
    schemaVersion: Schema.Literal(CACHE_SCHEMA_VERSION),
    environmentId: Schema.String,
    captains: Schema.Array(Captain),
  }),
);
const decodeStoredCaptains = Schema.decodeUnknownEffect(StoredCaptains);
const encodeStoredCaptains = Schema.encodeEffect(StoredCaptains);

export type CachedCaptains = ReadonlyMap<EnvironmentId, ReadonlyArray<Captain>>;

const NO_CACHED_CAPTAINS: CachedCaptains = new Map();
const captainsCacheRuntime = Atom.runtime(Runtime.layer);

// Payloads last read or written, so an unchanged live list is not rewritten.
const persistedPayloads = new Map<EnvironmentId, string>();

/** Each environment's Captains from its last live list, read once at launch. */
export const cachedCaptainsAtom = captainsCacheRuntime
  .atom(
    MobileDatabase.MobileDatabase.pipe(
      Effect.flatMap((database) => database.listCache(CACHE_KIND)),
      Effect.flatMap((payloads) =>
        Effect.forEach(payloads, (payload) =>
          decodeStoredCaptains(payload).pipe(
            Effect.map((stored) => {
              persistedPayloads.set(stored.environmentId as EnvironmentId, payload);
              return Option.some([stored.environmentId as EnvironmentId, stored.captains] as const);
            }),
            Effect.catch(() => Effect.succeedNone),
          ),
        ),
      ),
      Effect.map((entries): CachedCaptains => new Map(entries.flatMap(Option.toArray))),
      Effect.catch((error) =>
        Effect.logWarning("Could not read cached Captains.", error).pipe(
          Effect.as(NO_CACHED_CAPTAINS),
        ),
      ),
    ),
  )
  .pipe(Atom.keepAlive, Atom.withLabel("mobile:captains:cached"));

export function cachedCaptainsOf(result: AsyncResult.AsyncResult<CachedCaptains, unknown>) {
  return AsyncResult.isSuccess(result) ? result.value : NO_CACHED_CAPTAINS;
}

/** True once the launch read has finished, whether or not it found anything. */
export const captainsCacheReadAtom = Atom.make(
  (get) => get(cachedCaptainsAtom)._tag !== "Initial",
).pipe(Atom.withLabel("mobile:captains:cache-read"));

/** Keeps the environment's live Captains for the next launch's first frame. */
export function persistCaptains(environmentId: EnvironmentId, captains: ReadonlyArray<Captain>) {
  void Runtime.runtime.runPromise(
    Effect.gen(function* () {
      const payload = yield* encodeStoredCaptains({
        schemaVersion: CACHE_SCHEMA_VERSION,
        environmentId,
        captains,
      });
      if (persistedPayloads.get(environmentId) === payload) return;
      persistedPayloads.set(environmentId, payload);
      const database = yield* MobileDatabase.MobileDatabase;
      yield* database.saveCache(
        environmentId,
        CACHE_KIND,
        CACHE_KEY,
        CACHE_SCHEMA_VERSION,
        payload,
      );
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => persistedPayloads.delete(environmentId)).pipe(
          Effect.andThen(Effect.logWarning("Could not cache Captains.", error)),
        ),
      ),
    ),
  );
}
