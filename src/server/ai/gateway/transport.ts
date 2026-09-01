import { isIP } from "node:net";
import { AIProviderGatewayError, safeProviderErrorMessage } from "./errors";

export const AI_PROVIDER_HTTP_LIMITS = {
  maxUrlBytes: 2_048,
  maxRequestHeaderBytes: 16 * 1_024,
  maxResponseHeaderBytes: 32 * 1_024,
  maxResponseBodyBytes: 4 * 1_024 * 1_024,
  maxStreamFrameBytes: 256 * 1_024,
} as const;

export interface OutboundAddressResolver {
  resolve(hostname: string): Promise<readonly string[]>;
}

export interface ValidatedOutboundTarget {
  url: string;
  hostname: string;
  port: number;
  resolvedAddresses: readonly string[];
}

export interface OutboundTargetPolicy {
  validate(target: string | URL): Promise<ValidatedOutboundTarget>;
}

export interface AIProviderHttpRequest {
  method: string;
  pathAndQuery: string;
  headers?: Readonly<Record<string, string>>;
  body?: Uint8Array;
  signal: AbortSignal;
  timeoutMs: number;
}

export interface AIProviderHttpResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: AsyncIterable<Uint8Array>;
}

/** Adapters receive validated targets; they do not perform their own DNS/SSRF checks. */
export interface AIProviderHttpTransport {
  request(
    target: ValidatedOutboundTarget,
    request: AIProviderHttpRequest,
  ): Promise<AIProviderHttpResponse>;
}

export const REDACTED_PROVIDER_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "cookie",
  "set-cookie",
]);

export function redactProviderHeaders(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      REDACTED_PROVIDER_HEADER_NAMES.has(name.toLowerCase())
        ? "[REDACTED]"
        : value.slice(0, 1_024),
    ]),
  );
}

export class StrictOutboundTargetPolicy implements OutboundTargetPolicy {
  constructor(private readonly resolver: OutboundAddressResolver) {}

  async validate(target: string | URL): Promise<ValidatedOutboundTarget> {
    let url: URL;
    try {
      url = target instanceof URL ? new URL(target.toString()) : new URL(target);
    } catch {
      throw outboundTargetError();
    }
    if (url.protocol !== "https:") {
      throw outboundTargetError();
    }
    if (url.username || url.password) {
      throw outboundTargetError();
    }
    if (Buffer.byteLength(url.toString(), "utf8") > AI_PROVIDER_HTTP_LIMITS.maxUrlBytes) {
      throw outboundTargetError();
    }
    const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
    if (!hostname) throw outboundTargetError();
    let resolvedAddresses: string[];
    try {
      resolvedAddresses = [...new Set(await this.resolver.resolve(hostname))];
    } catch {
      throw outboundTargetError();
    }
    if (!resolvedAddresses.length) {
      throw outboundTargetError();
    }
    if (
      resolvedAddresses.some(
        (address) => typeof address !== "string" || isDisallowedOutboundAddress(address),
      )
    ) {
      throw outboundTargetError();
    }
    const port = Number(url.port || 443);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw outboundTargetError();
    }
    return {
      url: url.toString(),
      hostname,
      port,
      resolvedAddresses,
    };
  }
}

function outboundTargetError(): AIProviderGatewayError {
  return new AIProviderGatewayError(
    "CONFIGURATION",
    safeProviderErrorMessage("CONFIGURATION"),
  );
}

export function isDisallowedOutboundAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isDisallowedIPv4(address);
  if (version === 6) return isDisallowedIPv6(address);
  return true;
}

function isDisallowedIPv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const value = ((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3];
  const ranges: Array<[number, number]> = [
    [0x00000000, 0x00ffffff], // 0.0.0.0/8
    [0x0a000000, 0x0affffff], // RFC1918
    [0x64400000, 0x647fffff], // shared address space
    [0x7f000000, 0x7fffffff], // loopback
    [0xa9fe0000, 0xa9feffff], // link-local / metadata
    [0xac100000, 0xac1fffff], // RFC1918
    [0xc0000000, 0xc00000ff], // IETF protocol assignments
    [0xc0000200, 0xc00002ff], // documentation
    [0xc0a80000, 0xc0a8ffff], // RFC1918
    [0xc6120000, 0xc613ffff], // benchmarking
    [0xc6336400, 0xc63364ff], // documentation
    [0xcb007100, 0xcb0071ff], // documentation
    [0xe0000000, 0xffffffff], // multicast/reserved
  ];
  return ranges.some(([start, end]) => value >= start && value <= end);
}

function isDisallowedIPv6(address: string): boolean {
  const value = parseIPv6(address);
  if (value === null) return true;
  const unspecified = value.every((group) => group === 0);
  const loopback = value.slice(0, 7).every((group) => group === 0) && value[7] === 1;
  if (unspecified || loopback) return true;
  if (inIPv6Range(value, "fc00::", 7)) return true;
  if (inIPv6Range(value, "fe80::", 10)) return true;
  if (inIPv6Range(value, "ff00::", 8)) return true;
  if (inIPv6Range(value, "2001:db8::", 32)) return true;

  const firstFiveZero = value.slice(0, 5).every((group) => group === 0);
  const firstSixZero = value.slice(0, 6).every((group) => group === 0);
  const mapped = (value[6] << 16) | value[7];
  if ((firstFiveZero && value[5] === 0xffff) || firstSixZero) {
    const dotted = [
      (mapped >>> 24) & 0xff,
      (mapped >>> 16) & 0xff,
      (mapped >>> 8) & 0xff,
      mapped & 0xff,
    ].join(".");
    return isDisallowedIPv4(dotted);
  }
  return false;
}

function inIPv6Range(value: number[], network: string, prefixLength: number): boolean {
  const networkValue = parseIPv6(network);
  if (networkValue === null) return true;
  const completeGroups = Math.floor(prefixLength / 16);
  if (!value.slice(0, completeGroups).every((group, index) => group === networkValue[index])) return false;
  const remainingBits = prefixLength % 16;
  if (remainingBits === 0) return true;
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (value[completeGroups] & mask) === (networkValue[completeGroups] & mask);
}

function parseIPv6(address: string): number[] | null {
  const normalized = address.toLowerCase().replace(/^\[|\]$/gu, "");
  if (normalized.includes("%")) return null;
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const parsePart = (part: string): number[] => {
    if (!part) return [];
    const pieces = part.split(":");
    const output: number[] = [];
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index];
      if (piece.includes(".")) {
        if (index !== pieces.length - 1) return [];
        const octets = piece.split(".").map(Number);
        if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return [];
        output.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/u.test(piece)) return [];
        output.push(Number.parseInt(piece, 16));
      }
    }
    return output;
  };
  const left = parsePart(halves[0]);
  const right = halves.length === 2 ? parsePart(halves[1]) : [];
  if (left.length + right.length > 8 || (halves.length === 1 && left.length !== 8)) return null;
  const groups = halves.length === 2
    ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
    : left;
  if (groups.length !== 8) return null;
  return groups;
}
