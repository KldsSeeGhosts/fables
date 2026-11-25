import type { CaptainDocumentName, CaptainId, EnvironmentId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { ArrowLeftIcon, FileTextIcon } from "lucide-react";
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, ContentButton } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { captainCommandError } from "./useCaptain";

type CaptainDocumentDetails = {
  readonly captain: { readonly id: CaptainId };
  readonly documents: ReadonlyArray<{
    readonly name: CaptainDocumentName;
    readonly content: string;
    readonly revision: number;
  }>;
};

const DOCUMENT_NAMES: ReadonlyArray<CaptainDocumentName> = [
  "AGENTS.md",
  "NOTES.md",
  "CREW.md",
  "DIGEST.md",
];

function useDocumentCopy(name: CaptainDocumentName): string {
  const gt = useGT();
  switch (name) {
    case "AGENTS.md":
      return gt("Working instructions the Duet receives at the start of each conversation.");
    case "NOTES.md":
      return gt("Long-term notes the Duet receives at the start of each conversation.");
    case "CREW.md":
      return gt("Rules passed to every task this Duet delegates.");
    case "DIGEST.md":
      return gt("A running summary written by the morning brief.");
  }
}

function DocumentRow({
  name,
  empty,
  onOpen,
}: {
  readonly name: CaptainDocumentName;
  readonly empty: boolean;
  readonly onOpen: () => void;
}) {
  const gt = useGT();
  const copy = useDocumentCopy(name);
  return (
    <ContentButton
      variant="inset-row-multiline"
      className="h-auto min-h-12 items-start"
      onClick={onOpen}
    >
      <FileTextIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-label text-foreground">{name}</span>
        <span className="block text-meta text-muted-foreground">{copy}</span>
      </span>
      <span className="shrink-0 text-meta text-muted-foreground">
        {empty ? gt("Empty") : gt("Edit")}
      </span>
    </ContentButton>
  );
}

function DocumentEditor({
  details,
  environmentId,
  name,
  onBack,
}: {
  readonly details: CaptainDocumentDetails;
  readonly environmentId: EnvironmentId;
  readonly name: CaptainDocumentName;
  readonly onBack: () => void;
}) {
  const gt = useGT();
  const document = details.documents.find((entry) => entry.name === name) ?? {
    name,
    content: "",
    revision: 0,
  };
  const [content, setContent] = useState(document.content);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const update = useAtomCommand(serverEnvironment.updateCaptainDocument, { reportFailure: false });
  const copy = useDocumentCopy(name);

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await update({
      environmentId,
      input: {
        captainId: details.captain.id,
        name,
        content,
        expectedRevision: document.revision,
      },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      setError(captainCommandError(result, gt("Could not save the document.")));
      return;
    }
    onBack();
  };

  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-2">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={gt("Back to documents")}
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0">
          <h4 className="text-label text-foreground">{name}</h4>
          <p className="text-meta text-muted-foreground">{copy}</p>
        </div>
      </div>
      <Textarea
        aria-label={name}
        rows={10}
        value={content}
        disabled={saving}
        onChange={(event) => setContent(event.target.value)}
      />
      {error ? (
        <p role="alert" className="text-meta text-destructive-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" disabled={saving} onClick={onBack}>
          <T>Cancel</T>
        </Button>
        <Button type="button" disabled={saving} onClick={() => void save()}>
          <T>Save document</T>
        </Button>
      </div>
    </div>
  );
}

/** The Captain's document list; choosing one replaces the list with that document's editor. */
export function CaptainDocuments({
  details,
  environmentId,
}: {
  readonly details: CaptainDocumentDetails;
  readonly environmentId: EnvironmentId;
}) {
  const [editing, setEditing] = useState<CaptainDocumentName | null>(null);
  if (editing !== null) {
    return (
      <DocumentEditor
        key={editing}
        details={details}
        environmentId={environmentId}
        name={editing}
        onBack={() => setEditing(null)}
      />
    );
  }
  return (
    <div className="grid gap-1">
      {DOCUMENT_NAMES.map((name) => (
        <DocumentRow
          key={name}
          name={name}
          empty={
            (details.documents.find((document) => document.name === name)?.content.trim() ?? "") ===
            ""
          }
          onOpen={() => setEditing(name)}
        />
      ))}
    </div>
  );
}
