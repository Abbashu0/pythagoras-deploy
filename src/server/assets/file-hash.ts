import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export async function sha256File(
  filePath: string,
): Promise<{ sha256: string; byteSize: number }> {
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const chunk of createReadStream(filePath)) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    hash.update(bytes);
    byteSize += bytes.byteLength;
  }
  return { sha256: hash.digest("hex"), byteSize };
}

export async function sha256Stream(
  stream: ReadableStream<Uint8Array>,
): Promise<{ sha256: string; byteSize: number }> {
  const hash = createHash("sha256");
  let byteSize = 0;
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      hash.update(result.value);
      byteSize += result.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return { sha256: hash.digest("hex"), byteSize };
}
