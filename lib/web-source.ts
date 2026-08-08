import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { normalizeSourceText } from "./source-indexing.ts";

const MAX_WEB_SOURCE_BYTES = 2 * 1024 * 1024;
const allowedTypes = ["text/html", "text/plain", "text/markdown", "application/json", "application/xml", "text/xml"];

export function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (isIP(address) === 6) {
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
  }
  return true;
}

async function validatePublicUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use a public HTTP or HTTPS URL without embedded credentials.");
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) throw new Error("Private or local network URLs cannot be indexed.");
  return url;
}

function decodeEntities(value: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const point = entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

export function extractReadableWebText(body: string, contentType: string) {
  if (!contentType.includes("html")) return normalizeSourceText(body);
  const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const description = body.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1] ?? "";
  const text = body
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|article|section|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return normalizeSourceText(decodeEntities(`${title}\n${description}\n${text}`));
}

async function readLimited(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_WEB_SOURCE_BYTES) throw new Error("That page is larger than the 2 MB indexing limit.");
  if (!response.body) throw new Error("The page returned no readable content.");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WEB_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error("That page is larger than the 2 MB indexing limit.");
    }
    parts.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.byteLength; }
  return { text: new TextDecoder().decode(joined), size };
}

export async function fetchPublicWebSource(value: string) {
  let url = await validatePublicUrl(value);
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "AsyncFoundersSourceIndexer/1.0", accept: "text/html,text/plain,application/json,application/xml;q=0.9" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === 5) throw new Error("The page redirected too many times.");
      url = await validatePublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`The page returned HTTP ${response.status}.`);
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!allowedTypes.includes(contentType)) throw new Error("That URL is not a readable HTML, text, JSON or XML page.");
    const body = await readLimited(response);
    const text = extractReadableWebText(body.text, contentType);
    if (text.length < 40) throw new Error("The page did not contain enough readable text to index.");
    return { finalUrl: url.toString(), contentType, text, byteSize: body.size };
  }
  throw new Error("The page could not be fetched.");
}
