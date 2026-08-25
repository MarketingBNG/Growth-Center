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
      { label: 'Integrations', href: '/integrations', icon: 'Plug' },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { label: 'Tasks', href: '/tasks', icon: 'CircleCheck' },
      { label: 'Team', href: '/team', icon: 'UserCog' },
      { label: 'Settings', href: '/settings', icon: 'Settings' },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV.flatMap((s) => s.items);
