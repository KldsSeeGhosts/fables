export const ANTIGRAVITY_GATEWAY_EFFORT_OPTION_ID = "reasoningEffort";

const EFFORTS = Object.entries({
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
});
const ROUTE_SUFFIX = /-(minimal|low|medium|high|xhigh|max)$/;
const SETTING_SUFFIX = /\((minimal|low|medium|high|xhigh|max)\)$/i;
const LABEL_SUFFIX = / \((?:minimal|low|medium|high|xhigh|extra high|max)\)$/i;

interface AntigravityGatewayModelOption {
  readonly value: string;
  readonly name: string;
}

function routeFamily(id: string) {
  return id.replace(ROUTE_SUFFIX, "");
}

function matchesRoute(selection: string, id: string) {
  return selection === id || (!ROUTE_SUFFIX.test(selection) && selection === routeFamily(id));
}

export function antigravityGatewayModelSelections(configured: string) {
  return [
    ...new Set(
      configured
        .split(",")
        .map((id) =>
          id.trim().replace(SETTING_SUFFIX, (_, effort: string) => `-${effort.toLowerCase()}`),
        )
        .filter(Boolean),
    ),
  ];
}

export function antigravityHasConfiguredGatewayModel(
  selections: ReadonlyArray<string>,
  model: string,
) {
  return selections.some(
    (selection) => matchesRoute(selection, model) || routeFamily(selection) === model,
  );
}

export function antigravityGatewayModelRows(
  selections: ReadonlyArray<string>,
  models: ReadonlyArray<AntigravityGatewayModelOption>,
) {
  const grouped = new Map<string, Map<string, AntigravityGatewayModelOption>>();
  for (const selection of selections) {
    for (const model of models) {
      if (!matchesRoute(selection, model.value)) continue;
      const family = routeFamily(model.value);
      const entries = grouped.get(family) ?? new Map();
      entries.set(model.value, model);
      grouped.set(family, entries);
    }
  }
  return Array.from(grouped, ([family, entries]) => {
    const routes = [...entries.values()];
    const first = routes[0]!;
    const efforts = EFFORTS.flatMap(([effort, label]) => {
      const route = entries.get(`${family}-${effort}`);
      return route ? [{ value: effort, label, route }] : [];
    });
    const defaultEffort = efforts.find((effort) => effort.value === "medium") ?? efforts[0];
    const familySelected =
      selections.includes(family) ||
      selections.filter((selection) => routeFamily(selection) === family).length > 1;
    return {
      slug: familySelected ? family : first.value,
      name: first.name.trim().replace(LABEL_SUFFIX, "") || family,
      routes,
      efforts: efforts.map((effort) => ({ ...effort, isDefault: effort === defaultEffort })),
      defaultRoute: defaultEffort?.route.value ?? first.value,
    };
  });
}
