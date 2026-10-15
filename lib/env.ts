import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  serviceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
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
