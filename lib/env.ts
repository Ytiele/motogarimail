import "server-only";

function required(name: string, ...alternatives: string[]): string {
  const v = [name, ...alternatives].map((n) => process.env[n]).find(Boolean);
  if (!v) throw new Error(`Missing required environment variable ${[name, ...alternatives].join(" or ")}`);
  return v;
}

export const env = {
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  // Newer Supabase projects call these the publishable and secret keys; the legacy anon / service_role names also work.
  supabaseAnonKey: () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  serviceRoleKey: () => required("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
  googleClientId: () => required("GOOGLE_CLIENT_ID"),
  googleClientSecret: () => required("GOOGLE_CLIENT_SECRET"),
  googleRedirectUri: () => required("GOOGLE_REDIRECT_URI"),
  encryptionKey: () => required("GMAIL_ENCRYPTION_KEY"),
  pubsubTopic: () => process.env.GMAIL_PUBSUB_TOPIC || null,
  pushToken: () => process.env.GMAIL_PUSH_TOKEN || null,
  cronSecret: () => process.env.CRON_SECRET || null,
  mailProvider: (): "gmail" | "mock" => (process.env.MAIL_PROVIDER === "mock" ? "mock" : "gmail"),
  googleConfigured: () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI),
};
