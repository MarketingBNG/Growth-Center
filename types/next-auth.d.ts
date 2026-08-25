import type { Role } from '@/lib/roles';

declare module 'next-auth' {
  interface Session {
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: Role;
      initials?: string;
      displayRole?: string;
      team?: string;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: Role;
    initials?: string;
    displayRole?: string;
    team?: string;
  }
}
