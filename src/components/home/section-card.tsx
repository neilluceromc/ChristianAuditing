import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import type { SectionResult } from "@/lib/section";
import { RetrySection } from "./retry-section";

/**
 * Renders a section, or the designed FAILED state (README 1d): a red-bordered
 * card with a FAILED pill, a plain explanation, and "Retry this section" —
 * while every other section on the page renders normally.
 */
export function SectionCard<T>({
  title,
  result,
  actions,
  children,
  className,
}: {
  title: string;
  result: SectionResult<T>;
  actions?: React.ReactNode;
  children: (data: T) => React.ReactNode;
  className?: string;
}) {
  if (result.ok) {
    return (
      <Card className={className}>
        <CardHeader title={title} actions={actions} />
        <CardBody>{children(result.data)}</CardBody>
      </Card>
    );
  }
  return (
    <Card className={className} style={{ borderColor: "var(--st-fault-border)" }}>
      <CardHeader title={title} actions={<Pill tone="neutral">FAILED</Pill>} />
      <CardBody className="flex flex-col items-start gap-2">
        <p className="text-xs text-fg-secondary">
          {result.message} The rest of this page is unaffected.
        </p>
        <RetrySection label={title} />
      </CardBody>
    </Card>
  );
}
