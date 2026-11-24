import type { ProjectId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { T, Var } from "gt-react";

import { Checkbox } from "../ui/checkbox";

export function CaptainScope({
  projects,
  selected,
  disabled,
  onChange,
}: {
  projects: ReadonlyArray<EnvironmentProject>;
  selected: ReadonlyArray<ProjectId>;
  disabled: boolean;
  onChange: (projectIds: ReadonlyArray<ProjectId>) => void;
}) {
  const available = projects.filter(
    (project) =>
      !project.isScratch && (project.archivedAt === null || selected.includes(project.id)),
  );
  const choices = [
    ...available.map(({ id, title }) => ({ id, title })),
    ...selected
      .filter((id) => !available.some((project) => project.id === id))
      .map((id) => ({ id, title: id })),
  ];
  return (
    <fieldset className="min-w-0 space-y-2" disabled={disabled}>
      <legend className="text-label">
        <T>Workspace scope</T>
      </legend>
      <p className="text-meta text-muted-foreground">
        {selected.length === 0 ? (
          <T>Not limited to any project. The Captain works in a scratch folder.</T>
        ) : (
          <T>The Captain can delegate work only to the selected projects.</T>
        )}
      </p>
      {choices.length > 0 ? (
        <div className="max-h-40 overflow-y-auto rounded-lg border border-border p-1">
          {choices.map(({ id, title }) => (
            <label
              key={id}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-body hover:bg-accent"
            >
              <Checkbox
                checked={selected.includes(id)}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  onChange(checked ? [...selected, id] : selected.filter((value) => value !== id))
                }
              />
              <span className="min-w-0 truncate">
                <Var>{title}</Var>
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}
