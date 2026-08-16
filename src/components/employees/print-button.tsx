"use client";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button variant="primary" className="print:hidden" onClick={() => window.print()}>
      Print
    </Button>
  );
}
