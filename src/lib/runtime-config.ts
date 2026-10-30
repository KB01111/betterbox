export type RuntimeConfig = {
  baseURL: string;
  secret: string;
  google: { clientId: string; clientSecret: string };
  github?: { clientId: string; clientSecret: string };
  allowedEmails: ReadonlySet<string>;
  isSelfHosted: boolean;
  imageProxyHosts: string[];
};

export class ConfigurationError extends Error {}

export function parseRuntimeConfig(values: Record<string, unknown>): RuntimeConfig {
  const read = (name: string) => typeof values[name] === "string" ? values[name].trim() : "";
  const requireValue = (name: string) => {
    const value = read(name);
    if (!value || value === "...") throw new ConfigurationError(`${name} is required`);
    return value;
  };
  const secret = requireValue("BETTER_AUTH_SECRET");
  if (secret.length < 32) throw new ConfigurationError("BETTER_AUTH_SECRET must contain at least 32 characters");
  const url = new URL(requireValue("BETTER_AUTH_URL"));
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new ConfigurationError("BETTER_AUTH_URL must be an origin");
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new ConfigurationError("BETTER_AUTH_URL must use HTTPS outside localhost");
  const allowedEmails = new Set(requireValue("ALLOWED_EMAILS").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
  if (!allowedEmails.size || [...allowedEmails].some((email) => email !== "*@gmail.com" && !/^[^\s@*]+@[^\s@*]+\.[^\s@*]+$/.test(email))) throw new ConfigurationError("ALLOWED_EMAILS must list exact email addresses or *@gmail.com");
  const githubId = read("GITHUB_CLIENT_ID");
  const githubSecret = read("GITHUB_CLIENT_SECRET");
  if (Boolean(githubId) !== Boolean(githubSecret)) throw new ConfigurationError("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be configured together");
  const selfHosted = read("IS_SELF_HOSTED") || "true";
  if (!["true", "false"].includes(selfHosted)) throw new ConfigurationError("IS_SELF_HOSTED must be true or false");
  const imageProxyHosts = read("IMAGE_PROXY_HOSTS").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (imageProxyHosts.some((host) => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host))) throw new ConfigurationError("IMAGE_PROXY_HOSTS must contain exact DNS hostnames");
  return { baseURL: url.origin, secret, google: { clientId: requireValue("GOOGLE_CLIENT_ID"), clientSecret: requireValue("GOOGLE_CLIENT_SECRET") }, github: githubId ? { clientId: githubId, clientSecret: githubSecret } : undefined, allowedEmails, isSelfHosted: selfHosted === "true", imageProxyHosts };
}

export function isAllowedEmail(config: Pick<RuntimeConfig, "allowedEmails">, email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return config.allowedEmails.has(normalized) || (config.allowedEmails.has("*@gmail.com") && /^[^\s@*]+@gmail\.com$/.test(normalized));
}
