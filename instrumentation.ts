// Next.js calls register() once per server process. Event handlers are registered
// here so no route handler has to remember to import them.
export async function register() {
  const { registerAutomations } = await import('./lib/automation.ts');
  registerAutomations();
}
