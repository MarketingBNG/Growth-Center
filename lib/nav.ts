import type { Permission } from './roles.ts';

export type NavItem = {
  label: string;
  href: string;
  icon: string;
  permission?: Permission;
  /** Shown greyed with a "soon" tag until the module lands. */
  pending?: boolean;
};

export type NavSection = {
  title?: string;
  items: NavItem[];
};

// Settings and Integrations live in the account menu at the foot of the sidebar rather
// than in the nav list. They are workspace configuration, opened occasionally, and mixing
// them into the daily modules made the list longer without making anything easier to
// find — the same reason every app of this shape puts them behind the account button.
// The Glossary sits here for the same reason: it is reference, looked up when two reports
// disagree, not a daily module. It is readable by everyone — a definition nobody can look
// up is a definition people guess at, which is what Appendix C exists to stop.
export const ACCOUNT_NAV: NavItem[] = [
  { label: 'Glossary', href: '/glossary', icon: 'BookOpen' },
  { label: 'Settings', href: '/settings', icon: 'Settings' },
  { label: 'Integrations', href: '/integrations', icon: 'Plug' },
  { label: 'Team', href: '/team', icon: 'UserCog' },
];

// The shell renders from this array. Adding a module means adding a line here, not
// editing the sidebar.
//
// "Growth › Overview" from the original brief is deliberately absent: it was the same
// screen as Dashboard. One command centre, not two.
export const NAV: NavSection[] = [
  {
    items: [{ label: 'Dashboard', href: '/', icon: 'LayoutDashboard' }],
  },
  {
    title: 'Growth',
    items: [
      { label: 'Leads', href: '/leads', icon: 'Sparkles' },
      { label: 'CRM', href: '/crm', icon: 'Users' },
      { label: 'Pipeline', href: '/pipeline', icon: 'Kanban' },
      { label: 'Marketing', href: '/marketing', icon: 'Megaphone' },
      { label: 'SEO', href: '/seo', icon: 'Search' },
      { label: 'Paid Ads', href: '/ads', icon: 'BadgeDollarSign' },
      { label: 'Social', href: '/social', icon: 'Share2' },
      { label: 'Outreach', href: '/outreach', icon: 'Send' },
      { label: 'Content', href: '/content', icon: 'FileText' },
      { label: 'Analytics', href: '/analytics', icon: 'ChartLine' },
      { label: 'Reports', href: '/reports', icon: 'ClipboardList' },
      { label: 'AI Insights', href: '/ai', icon: 'Brain' },
    ],
  },
  {
    title: 'Workspace',
    items: [{ label: 'Tasks', href: '/tasks', icon: 'CircleCheck' }],
  },
];

/** Everything reachable, including the account menu — so a future search or command
 *  palette can still find Settings even though the sidebar no longer lists it. */
export const ALL_NAV_ITEMS = [...NAV.flatMap((s) => s.items), ...ACCOUNT_NAV];
