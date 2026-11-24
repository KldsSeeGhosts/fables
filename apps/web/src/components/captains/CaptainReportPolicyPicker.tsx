import { CaptainReportPolicy } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { Radio, RadioGroup } from "../ui/radio-group";

export function CaptainReportPolicyPicker({
  value,
  disabled,
  labelledBy,
  onChange,
}: {
  value: CaptainReportPolicy;
  disabled: boolean;
  labelledBy: string;
  onChange: (policy: CaptainReportPolicy) => void;
}) {
  const gt = useGT();
  const labels = {
    react: gt("Wake the Captain"),
    context: gt("Include on its next turn"),
    ignore: gt("Don’t report back"),
  };
  const descriptions = {
    react: gt("A delegated task report can start a Captain turn."),
    context: gt("Recent reports are included on the next Captain turn."),
    ignore: gt("Reports stay in the delegated task’s history."),
  };
  return (
    <RadioGroup
      aria-labelledby={labelledBy}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const policy = CaptainReportPolicy.literals.find((policy) => policy === next);
        if (policy !== undefined && policy !== value) onChange(policy);
      }}
    >
      {CaptainReportPolicy.literals.map((policy) => (
        <label
          key={policy}
          className="flex cursor-pointer items-start gap-2 has-data-disabled:cursor-not-allowed has-data-disabled:opacity-64"
        >
          <Radio value={policy} />
          <span className="min-w-0">
            <span className="block text-body text-foreground">{labels[policy]}</span>
            <span className="block text-meta text-muted-foreground">{descriptions[policy]}</span>
          </span>
        </label>
      ))}
    </RadioGroup>
  );
}
