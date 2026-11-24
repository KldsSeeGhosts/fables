import { useAtomValue } from "@effect/atom-react";
import {
  CaptainMemoryId,
  type CaptainId,
  type CaptainMemory,
  type EnvironmentId,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { LockKeyholeIcon, PencilIcon, PinIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";

import { randomUUID } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Textarea } from "../ui/textarea";
import { captainCommandError } from "./useCaptain";

export function CaptainMemories({
  captainId,
  environmentId,
  memories,
}: {
  captainId: CaptainId;
  environmentId: EnvironmentId;
  memories: ReadonlyArray<CaptainMemory>;
}) {
  const gt = useGT();
  const id = useId();
  const [edit, setEdit] = useState<{
    id: CaptainMemoryId;
    text: string;
    essential: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const canEdit = useAtomValue(serverEnvironment.upsertCaptainMemory.permissionAtom(environmentId));
  const canDelete = useAtomValue(
    serverEnvironment.deleteCaptainMemory.permissionAtom(environmentId),
  );
  const upsert = useAtomCommand(serverEnvironment.upsertCaptainMemory, { reportFailure: false });
  const remove = useAtomCommand(serverEnvironment.deleteCaptainMemory, { reportFailure: false });

  const save = async (memory: Pick<CaptainMemory, "id" | "text" | "essential">, close: boolean) => {
    if (pending || !canEdit || !memory.text.trim()) return;
    setPending(true);
    setError(null);
    const result = await upsert({
      environmentId,
      input: {
        id: memory.id,
        text: memory.text.trim(),
        essential: memory.essential,
        captainId,
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      setError(captainCommandError(result, gt("Could not save memory.")));
    } else if (close) {
      setEdit(null);
    }
  };

  const forget = async (id: CaptainMemoryId) => {
    if (pending || !canDelete) return;
    setPending(true);
    setError(null);
    const result = await remove({ environmentId, input: { captainId, id } });
    setPending(false);
    if (result._tag === "Failure")
      setError(captainCommandError(result, gt("Could not delete memory.")));
    else if (edit?.id === id) setEdit(null);
  };

  return (
    <section className="space-y-3">
      {memories.length === 0 && edit === null ? (
        <p className="text-body text-muted-foreground">
          <T>No memories yet.</T>
        </p>
      ) : null}
      {memories.map((memory) => (
        <div key={memory.id} className="space-y-2 rounded-md border border-border p-3">
          <p className="whitespace-pre-wrap break-words text-body">{memory.text}</p>
          <div className="flex flex-wrap items-center gap-1">
            {memory.essential ? (
              <Badge size="sm">
                <T>Essential</T>
              </Badge>
            ) : null}
            {memory.userControlled ? (
              <Badge size="sm">
                <LockKeyholeIcon />
                <T>Locked</T>
              </Badge>
            ) : null}
            <div className="ms-auto flex items-center">
              <Button
                variant="ghost"
                size="icon-xs"
                title={gt("Toggle essential")}
                aria-label={gt("Toggle essential")}
                aria-pressed={memory.essential}
                disabled={pending || !canEdit}
                onClick={() => void save({ ...memory, essential: !memory.essential }, false)}
              >
                <PinIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={pending || !canEdit}
                aria-label={gt("Edit memory")}
                title={gt("Edit memory")}
                onClick={() => setEdit(memory)}
              >
                <PencilIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={pending || !canDelete}
                aria-label={gt("Delete memory")}
                title={gt("Delete memory")}
                onClick={() => void forget(memory.id)}
              >
                <Trash2Icon />
              </Button>
            </div>
          </div>
        </div>
      ))}
      {edit !== null ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save(edit, true);
          }}
        >
          <label htmlFor={id} className="text-label">
            <T>Memory</T>
          </label>
          <Textarea
            id={id}
            rows={3}
            maxLength={4_000}
            value={edit.text}
            readOnly={pending || !canEdit}
            onChange={(event) => setEdit({ ...edit, text: event.target.value })}
          />
          <label className="flex items-center gap-2 text-body">
            <Checkbox
              checked={edit.essential}
              disabled={pending || !canEdit}
              onCheckedChange={(essential) => setEdit({ ...edit, essential })}
            />
            <T>Essential</T>
          </label>
          <p className="text-meta text-muted-foreground">
            <T>Memories you save are locked against agent edits.</T>
          </p>
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={pending || !canEdit || !edit.text.trim()}>
              <T>Save memory</T>
            </Button>
            <Button
              size="sm"
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setEdit(null)}
            >
              <T>Cancel</T>
            </Button>
          </div>
        </form>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || !canEdit}
          onClick={() =>
            setEdit({ id: CaptainMemoryId.make(randomUUID()), text: "", essential: false })
          }
        >
          <PlusIcon />
          <T>Add memory</T>
        </Button>
      )}
      {error !== null ? (
        <p role="alert" className="text-body text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </section>
  );
}
