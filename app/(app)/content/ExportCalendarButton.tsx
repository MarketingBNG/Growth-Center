'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

/**
 * Downloads the month.
 *
 * Plain links, not a fetch: the route answers with a file and a content-disposition, and
 * the browser is better at saving one than any code here would be.
 *
 * Two formats because they are for two things. The .xlsx opens ready to work in and is
 * what goes to whoever plans next month; the .csv is what an analyst or another system
 * reads. Both write the same columns in the same order as the import reads, so a calendar
 * exported here, edited in Sheets and uploaded again needs nothing renamed — which is
 * also the honest answer to "where do I get the template".
 */
export function ExportCalendarButton({ month, label }: { month: string; label: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="action" variant="outline" onClick={() => setOpen(true)}>
        <Download /> Export
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Export ${label}`}
        description="The same columns the import reads, so an export edited in a spreadsheet can be uploaded straight back."
      >
        <div className="space-y-2">
          <Button asChild variant="outline" className="w-full justify-start">
            <a
              href={`/api/content/calendar/export?month=${month}&format=xlsx`}
              onClick={() => setOpen(false)}
            >
              Excel workbook (.xlsx)
            </a>
          </Button>
          <Button asChild variant="outline" className="w-full justify-start">
            <a
              href={`/api/content/calendar/export?month=${month}&format=csv`}
              onClick={() => setOpen(false)}
            >
              CSV (.csv)
            </a>
          </Button>
        </div>
      </Modal>
    </>
  );
}
