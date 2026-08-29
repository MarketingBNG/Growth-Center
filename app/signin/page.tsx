import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { safeReturnTo } from '@/lib/return-to';
import { SignInCard } from './SignInCard';

export const metadata = { title: 'Sign in · Growth Center' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  if (await currentUser()) redirect('/');
  const { error, from } = await searchParams;
  const configured = !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
  return <SignInCard error={error} configured={configured} returnTo={safeReturnTo(from)} />;
}
