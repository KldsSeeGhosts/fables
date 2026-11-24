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
      <legend className="mb-1 text-label">
        <T>Workspace scope</T>
      </legend>
      {selected.length === 0 ? (
        <p className="text-meta text-muted-foreground">
          <T>No projects selected</T>
        </p>
      ) : null}
      {choices.length > 0 ? (
        <div className="max-h-40 space-y-2 overflow-y-auto p-0.5">
          {choices.map(({ id, title }) => (
            <label key={id} className="flex items-center gap-2 text-body">
              <Checkbox
                checked={selected.includes(id)}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  onChange(checked ? [...selected, id] : selected.filter((value) => value !== id))
                }
              />
              <span className="min-w-0 break-words">
                <Var>{title}</Var>
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}
