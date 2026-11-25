import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  CaptainDocumentName,
  CaptainError,
  type Captain,
  type CaptainDocument,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { T, useGT, Var } from "gt-react";
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { captainCommandError } from "./useCaptain";

const isCaptainError = Schema.is(CaptainError);

type Edit = { readonly content: string; readonly revision: number };

export function CaptainDocuments({
  captain,
  environmentId,
  documents,
  refresh,
  selected,
  onSelect,
}: {
  captain: Captain;
  environmentId: EnvironmentId;
  documents: ReadonlyArray<CaptainDocument>;
  refresh: () => void;
  /** Lets a caller pick the open document, as the Make view's cards do. */
  selected?: CaptainDocumentName;
  onSelect?: (name: CaptainDocumentName) => void;
}) {
  const gt = useGT();
  const [ownName, setOwnName] = useState<CaptainDocumentName>("NOTES.md");
  const name = selected ?? ownName;
  const setName = onSelect ?? setOwnName;
  const [edits, setEdits] = useState<Partial<Record<CaptainDocumentName, Edit>>>({});
  const [saved, setSaved] = useState<Partial<Record<CaptainDocumentName, CaptainDocument>>>({});
  const [serverConflict, setServerConflict] = useState<CaptainDocumentName | null>(null);
  const [error, setError] = useState<{ name: CaptainDocumentName; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const allowed = useAtomValue(
    serverEnvironment.updateCaptainDocument.permissionAtom(environmentId),
  );
  const update = useAtomCommand(serverEnvironment.updateCaptainDocument, { reportFailure: false });
  const live = documents.find(
    (document) => document.name === name && document.captainId === captain.id,
  );
  const justSaved = saved[name];
  const current = justSaved && justSaved.revision > (live?.revision ?? 0) ? justSaved : live;
  const currentRevision = current?.revision ?? 0;
  const currentContent = current?.content ?? "";
  const edit = edits[name];
  const conflict =
    edit !== undefined && (edit.revision < currentRevision || serverConflict === name);
  const canReconcile = edit !== undefined && edit.revision < currentRevision;

  const clearEdit = (documentName: CaptainDocumentName) =>
    setEdits((previous) => ({ ...previous, [documentName]: undefined }));
  const save = async () => {
    if (!allowed || edit === undefined || saving || conflict) return;
    setError(null);
    setSaving(true);
    const result = await update({
      environmentId,
      input: {
        captainId: captain.id,
        name,
        content: edit.content,
        expectedRevision: edit.revision,
      },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      if (isCaptainError(failure) && failure.code === "conflict") {
        setServerConflict(name);
        refresh();
      } else {
        setError({ name, text: captainCommandError(result, gt("Could not save document.")) });
      }
      return;
    }
    setSaved((previous) => ({ ...previous, [name]: result.value }));
    clearEdit(name);
  };

  return (
    <section className="space-y-3">
      <div className="overflow-x-auto">
        <ToggleGroup
          aria-label={gt("Captain documents")}
          value={[name]}
          onValueChange={(value) => {
            const selected = CaptainDocumentName.literals.find((entry) => entry === value[0]);
            if (selected !== undefined) setName(selected);
          }}
        >
          {CaptainDocumentName.literals.map((documentName) => (
            <Toggle value={documentName} key={documentName}>
              {documentName}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      <Textarea
        aria-label={name}
        rows={12}
        maxLength={64_000}
        spellCheck={false}
        readOnly={!allowed || saving}
        value={edit?.content ?? currentContent}
        onChange={(event) => {
          const content = event.target.value;
          setEdits({ ...edits, [name]: { content, revision: edit?.revision ?? currentRevision } });
        }}
      />
      <p className="text-meta text-muted-foreground">
        <T>
          Server revision <Var>{currentRevision}</Var>
        </T>
      </p>
      {conflict ? (
        <div className="space-y-2 rounded-md border border-warning/40 p-3">
          <p role="alert" className="text-body">
            <T>The server has a newer revision. Your draft is still here.</T>
          </p>
          {canReconcile ? (
            <>
              <details className="text-body">
                <summary className="cursor-pointer">
                  <T>View server copy</T>
                </summary>
                <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words text-meta">
                  {currentContent}
                </pre>
              </details>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    clearEdit(name);
                    setServerConflict(null);
                  }}
                >
                  <T>Use server copy</T>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setEdits({ ...edits, [name]: { ...edit, revision: currentRevision } });
                    setServerConflict(null);
                  }}
                >
                  <T>Keep my draft</T>
                </Button>
              </div>
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={refresh}>
              <T>Refresh revision</T>
            </Button>
          )}
        </div>
      ) : null}
      {error?.name === name ? (
        <p role="alert" className="text-body text-destructive-foreground">
          {error.text}
        </p>
      ) : null}
      <Button
        size="sm"
        onClick={() => void save()}
        disabled={
          !allowed || saving || conflict || edit === undefined || edit.content === currentContent
        }
      >
        <T>Save document</T>
      </Button>
    </section>
  );
}
