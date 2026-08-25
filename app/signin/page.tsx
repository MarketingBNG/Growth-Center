import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { SignInCard } from './SignInCard';

export const metadata = { title: 'Sign in · Growth Center' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentUser()) redirect('/');
  const { error } = await searchParams;
  const configured = !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
  return <SignInCard error={error} configured={configured} />;
}
