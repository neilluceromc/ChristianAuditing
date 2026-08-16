"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DensityToggle } from "@/components/ui/density-toggle";
import { DescriptionList } from "@/components/ui/description-list";
import { Dialog } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Menu } from "@/components/ui/menu";
import { Pagination } from "@/components/ui/pagination";
import { Pill } from "@/components/ui/pill";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Radio } from "@/components/ui/radio";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Stat } from "@/components/ui/stat";
import { StatusDot, StatusPill } from "@/components/ui/status";
import { Switch } from "@/components/ui/switch";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";

const ALL_STATUSES = [
  "DEPLOYED", "SPARE", "DEFECTIVE", "MISSING", "DONATED", "TEMPORARY", "BUYOUT", "DISPOSE",
  "DRAFT", "SUBMITTED", "IT_REVIEWED", "COMPLETED", "CANCELLED",
  "PENDING", "APPROVED", "REJECTED", "CLAIMED", "EXECUTED", "EXECUTION_FAILED",
  "ACTIVE", "FULFILLED", "RELEASED", "EXPIRED",
  "pending", "active", "offboarding", "inactive", "contractor",
];

const ICONS: IconName[] = [
  "laptop", "monitor", "phone", "dock", "headset", "inventory", "employee",
  "approval", "audit", "search", "filter", "sla", "alert", "secret", "export", "add",
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-fg-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Demos() {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [switchOn, setSwitchOn] = useState(true);
  const [segment, setSegment] = useState("returned");
  const [checked, setChecked] = useState<boolean[]>([true, false, false]);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-fg">Kitchen sink</h1>
          <p className="text-xs text-fg-muted">Every primitive, both themes, both densities.</p>
        </div>
        <div className="flex gap-2">
          <DensityToggle />
          <ThemeToggle />
        </div>
      </header>

      <Section title="Status system — pills">
        <div className="flex flex-wrap gap-1.5">
          {ALL_STATUSES.map((s) => <StatusPill key={s} value={s} />)}
        </div>
      </Section>

      <Section title="Status system — dots">
        <div className="flex flex-wrap items-center gap-3">
          {ALL_STATUSES.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-fg-secondary">
              <StatusDot value={s} /> {s}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Request swap</Button>
          <Button variant="secondary">Cancel</Button>
          <Button variant="ghost">Clear filters</Button>
          <Button variant="danger">Reject</Button>
          <Button variant="primary" loading>Saving…</Button>
          <Button variant="secondary" disabled>Disabled</Button>
          <Button variant="primary" size="sm">Small</Button>
          <Button variant="primary" size="lg">Large</Button>
          <IconButton aria-label="Add asset"><Icon name="add" size={16} /></IconButton>
          <Spinner />
        </div>
      </Section>

      <Section title="Icons">
        <div className="flex flex-wrap gap-3 text-fg-secondary">
          {ICONS.map((name) => (
            <span key={name} className="inline-flex flex-col items-center gap-1">
              <Icon name={name} />
              <span className="font-mono text-[8.5px] text-fg-muted">{name}</span>
            </span>
          ))}
        </div>
      </Section>

      <Section title="Form controls">
        <Card className="max-w-md">
          <CardBody className="flex flex-col gap-4">
            <FormField label="Asset tag" required hint="Format BR-XX-0000">
              {(p) => <Input {...p} placeholder="BR-LT-0148" invalid={p.invalid} />}
            </FormField>
            <FormField label="Model" error="Model is required">
              {(p) => <Input {...p} invalid={p.invalid} />}
            </FormField>
            <FormField label="Notes">
              {(p) => <Textarea {...p} placeholder="Append-only elsewhere; plain here." />}
            </FormField>
            <FormField label="Category">
              {(p) => (
                <Select {...p}>
                  <option>Laptop</option>
                  <option>Monitor</option>
                </Select>
              )}
            </FormField>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-fg-secondary">
                <Checkbox checked={checked[0]} onChange={(e) => setChecked([e.target.checked, checked[1], checked[2]])} /> Checked
              </label>
              <label className="flex items-center gap-2 text-xs text-fg-secondary">
                <Checkbox indeterminate readOnly checked={false} /> Indeterminate
              </label>
              <label className="flex items-center gap-2 text-xs text-fg-secondary">
                <Radio name="demo" defaultChecked /> Radio
              </label>
              <span className="flex items-center gap-2 text-xs text-fg-secondary">
                <Switch checked={switchOn} onCheckedChange={setSwitchOn} aria-label="Demo switch" /> Switch
              </span>
            </div>
            <SegmentedControl
              aria-label="Condition on return"
              value={segment}
              onChange={setSegment}
              options={[
                { value: "returned", label: "Returned" },
                { value: "defective", label: "Defective" },
                { value: "buyout", label: "Buyout" },
                { value: "missing", label: "Missing" },
              ]}
            />
          </CardBody>
        </Card>
      </Section>

      <Section title="Table (density-aware)">
        <Table>
          <THead>
            <Tr>
              <Th width={36}><Checkbox aria-label="Select all" indeterminate readOnly checked={false} /></Th>
              <Th width={20}><span className="sr-only">Status dot</span></Th>
              <Th width={104} sort="desc" sortIndex={1} onSort={() => {}}>Tag</Th>
              <Th>Model</Th>
              <Th width={168}>Assigned</Th>
              <Th width={88}>Status</Th>
            </Tr>
          </THead>
          <TBody>
            {[
              ["BR-LT-0148", "Dell Latitude 5420", "Marites Bautista", "DEPLOYED"],
              ["BR-LT-0181", "ThinkPad T14 Gen 4", "—", "SPARE"],
              ["BR-LT-0122", "Dell Latitude 5420", "—", "DEFECTIVE"],
              ["BR-LT-0075", "Dell Latitude 5400", "—", "DONATED"],
            ].map(([tag, model, holder, status], i) => (
              <Tr key={tag} selected={i === 0}>
                <Td><Checkbox aria-label={`Select ${tag}`} checked={i === 0} readOnly /></Td>
                <Td><StatusDot value={status} /></Td>
                <Td mono>{tag}</Td>
                <Td>{model}</Td>
                <Td className="text-fg-muted">{holder}</Td>
                <Td mono>{status}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        <div className="flex justify-end">
          <Pagination page={3} pageCount={12} hrefFor={(p) => `?page=${p}`} />
        </div>
      </Section>

      <Section title="Loading states">
        <Card className="max-w-md">
          <CardBody className="flex flex-col gap-2 p-0">
            <SkeletonRow columns={4} />
            <SkeletonRow columns={4} />
            <div className="px-3 pb-3"><Skeleton className="h-3 w-40" /></div>
          </CardBody>
        </Card>
      </Section>

      <Section title="Cards, stats, description list">
        <div className="grid max-w-3xl grid-cols-2 gap-4">
          <Card>
            <CardHeader title="Fleet" actions={<Pill tone="accent">IT</Pill>} />
            <CardBody className="grid grid-cols-2 gap-3">
              <Stat label="Items held" value="6" hint="of 8 slots" />
              <Stat label="Book value" value="₱214k" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="BR-LT-0148" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: "Model", value: "Dell Latitude 5420" },
                  { label: "Serial", value: "7GXK123", mono: true },
                  { label: "Status", value: <StatusPill value="DEPLOYED" /> },
                ]}
              />
            </CardBody>
          </Card>
        </div>
      </Section>

      <Section title="Banners">
        <div className="flex max-w-xl flex-col gap-2">
          <Banner tone="fault" title="Sent back by Finance" actions={<Button size="sm">Jump to unit 04</Button>}>
            IT_REVIEWED → SUBMITTED · nothing was cleared.
          </Banner>
          <Banner tone="attention" title="You've made 60 changes this minute — the cap">
            Nothing was lost: this form still holds your input.
          </Banner>
          <Banner tone="settled" title="Audit entry written" />
        </div>
      </Section>

      <Section title="Progress, breadcrumb, misc">
        <div className="flex max-w-md flex-col gap-4">
          <ProgressBar value={6} max={8} label="Loadout vs policy" />
          <Breadcrumb items={[{ label: "Inventory", href: "#" }, { label: "Repairs" }]} />
          <div className="flex items-center gap-3">
            <Avatar name="Marites Bautista" size="xl" />
            <Avatar name="J. Sarmiento" size="md" />
            <Tooltip content="Reads are audited">
              <Button variant="ghost" size="sm"><Icon name="secret" size={14} /> Reveal</Button>
            </Tooltip>
            <Kbd>⌘K</Kbd>
          </div>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs
          items={[
            { label: "Overview", href: "#", active: true },
            { label: "History", href: "#", active: false },
            { label: "Timeline", href: "#", active: false },
            { label: <>Secrets <Pill>AUDITED</Pill></>, href: "#", active: false },
          ]}
        />
      </Section>

      <Section title="Overlays">
        <div className="flex gap-2">
          <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
          <Button onClick={() => setDrawerOpen(true)}>Open drawer</Button>
          <Menu
            trigger={(p) => <Button {...p}>Row actions ⋯</Button>}
            items={[
              { label: "Open", onSelect: () => toast("Opened") },
              { label: "Request return", onSelect: () => toast("Return requested", "settled") },
              { label: "Dispose", danger: true, onSelect: () => toast("Not allowed", "fault") },
            ]}
          />
          <Button onClick={() => toast("Audit entry written", "settled")}>Toast</Button>
        </div>
        {/* Conditionally mounted ON PURPOSE — this is the pattern that once broke the trap */}
        {dialogOpen && (
          <Dialog
            open
            onClose={() => setDialogOpen(false)}
            title="Cancel request PR-0198?"
            footer={
              <>
                <Button variant="ghost" onClick={() => setDialogOpen(false)}>Keep it</Button>
                <Button variant="danger" onClick={() => setDialogOpen(false)}>Cancel request</Button>
              </>
            }
          >
            This can&apos;t be undone. A reason is required and will be appended to the thread.
          </Dialog>
        )}
        {drawerOpen && (
          <Drawer open onClose={() => setDrawerOpen(false)} title="Fill slot — headset">
            <EmptyState
              title="No spares available"
              description="All Jabra Evolve2 units are deployed. Reserve from the next purchase instead."
              actions={<Button variant="primary" size="sm">Reserve incoming</Button>}
            />
          </Drawer>
        )}
      </Section>

      <Section title="Empty state">
        <Card className="max-w-md">
          <EmptyState
            title="Your filters matched nothing"
            description="3 filters are active."
            actions={<Button variant="ghost" size="sm">Clear filters</Button>}
          />
        </Card>
      </Section>
    </main>
  );
}

export default function KitchenSinkPage() {
  // Dev-only review surface — never served in production builds.
  if (process.env.NODE_ENV === "production") notFound();
  // ToastProvider now lives in the root layout — a second one here would
  // double-announce via two aria-live regions.
  return <Demos />;
}
