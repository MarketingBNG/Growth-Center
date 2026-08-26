import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Reached by `notFound()` from the record detail pages, and by any unknown URL. */
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6">
      <div className="flex max-w-[420px] flex-col items-center gap-3 text-center">
        <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
          <FileQuestion className="size-5" />
        </span>
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">Not found</h1>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          That page or record does not exist. It may have been deleted, or the link may be
          wrong.
        </p>
        <Button asChild className="mt-1">
          <Link href="/">Back to the dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
