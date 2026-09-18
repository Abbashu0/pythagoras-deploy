const LOCAL_OMNIROUTE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export const LOCAL_OMNIROUTE_PORT = 20_128;
export const LOCAL_OMNIROUTE_PATH = "/v1";

/**
 * OmniRoute is the one deliberately supported local HTTP AI gateway. Keep
 * this allowlist exact so enabling it cannot turn the general Provider path
 * into an arbitrary loopback/private-network SSRF bypass.
 */
export function isLocalOmniRouteUrl(value: string | URL): boolean {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(value);
  } catch {
    return false;
  }

  const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  const pathname = url.pathname.replace(/\/+$/u, "") || "/";
  return (
    url.protocol === "http:" &&
    LOCAL_OMNIROUTE_HOSTS.has(hostname) &&
    Number(url.port) === LOCAL_OMNIROUTE_PORT &&
    pathname === LOCAL_OMNIROUTE_PATH &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  );
}
