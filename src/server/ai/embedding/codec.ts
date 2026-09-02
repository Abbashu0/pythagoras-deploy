import { createHash } from "node:crypto";

import {
  AI_EMBEDDING_MAX_DIMENSIONS,
  AI_EMBEDDING_MAX_VECTOR_BYTES,
  AI_EMBEDDING_VECTOR_CODEC_KEY,
  AI_EMBEDDING_VECTOR_CODEC_REVISION,
} from "./contracts";
import { AIEmbeddingError } from "./errors";

export interface AIEncodedEmbeddingVector {
  blob: Buffer;
  hash: string;
  norm: number;
  dimensions: number;
}

export interface AIEmbeddingVectorCodec {
  readonly key: typeof AI_EMBEDDING_VECTOR_CODEC_KEY;
  readonly revision: typeof AI_EMBEDDING_VECTOR_CODEC_REVISION;
  encode(values: readonly number[], expectedDimensions: number): AIEncodedEmbeddingVector;
  decode(blob: Buffer, expectedDimensions: number): number[];
}

/** Explicit little-endian Float32 storage; precision loss is intentional derived-index data. */
export class Float32LEEmbeddingVectorCodec implements AIEmbeddingVectorCodec {
  readonly key = AI_EMBEDDING_VECTOR_CODEC_KEY;
  readonly revision = AI_EMBEDDING_VECTOR_CODEC_REVISION;

  encode(values: readonly number[], expectedDimensions: number): AIEncodedEmbeddingVector {
    assertDimensions(expectedDimensions);
    if (!Array.isArray(values) || values.length !== expectedDimensions) {
      throw new AIEmbeddingError("AI_EMBEDDING_VECTOR_INVALID", "The embedding vector dimensions do not match the pinned model.");
    }
    const byteLength = expectedDimensions * 4;
    if (byteLength > AI_EMBEDDING_MAX_VECTOR_BYTES) {
      throw new AIEmbeddingError("AI_EMBEDDING_VECTOR_INVALID", "The embedding vector exceeds the safe storage bound.");
    }
    const blob = Buffer.allocUnsafe(byteLength);
    let scale = 0;
    for (const value of values) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new AIEmbeddingError("AI_EMBEDDING_VECTOR_INVALID", "The embedding vector contains a non-finite value.");
      }
      scale = Math.max(scale, Math.abs(value));
    }
    if (scale === 0) throw new AIEmbeddingError("AI_EMBEDDING_VECTOR_INVALID", "A zero-norm embedding vector is not valid.");
    for (let index = 0; index < values.length; index += 1) {
      blob.writeFloatLE(values[index], index * 4);
      if (!Number.isFinite(blob.readFloatLE(index * 4))) {
        throw new AIEmbeddingError("AI_EMBEDDING_VECTOR_INVALID", "The embedding vector cannot be represented as finite Float32 data.");
      }
    }
    const decoded = this.decode(blob, expectedDimensions);
    const norm = stableNorm(decoded);
    if (!Number.isFinite(norm) || norm <= 0) {
      throw new AIEmbeddingError("AI_EMBEDDING_VECTOR_INVALID", "The encoded embedding vector has an invalid norm.");
    }
    return {
      blob,
      hash: createHash("sha256").update(blob).digest("hex"),
      norm,
      dimensions: expectedDimensions,
    };
  }

  decode(blob: Buffer, expectedDimensions: number): number[] {
    assertDimensions(expectedDimensions);
    if (!Buffer.isBuffer(blob) || blob.byteLength !== expectedDimensions * 4 || blob.byteLength > AI_EMBEDDING_MAX_VECTOR_BYTES) {
      throw new AIEmbeddingError("AI_EMBEDDING_VECTOR_INVALID", "The stored embedding vector byte length is invalid.");
    }
    const values: number[] = [];
    for (let offset = 0; offset < blob.byteLength; offset += 4) {
      const value = blob.readFloatLE(offset);
      if (!Number.isFinite(value)) throw new AIEmbeddingError("AI_EMBEDDING_VECTOR_INVALID", "The stored embedding vector contains non-finite data.");
      values.push(value);
    }
    if (stableNorm(values) <= 0) throw new AIEmbeddingError("AI_EMBEDDING_VECTOR_INVALID", "A zero-norm stored embedding vector is not valid.");
    return values;
  }
}

export function createFloat32LEEmbeddingVectorCodec(): AIEmbeddingVectorCodec {
  return new Float32LEEmbeddingVectorCodec();
}

export function stableNorm(values: readonly number[]): number {
  let scale = 0;
  for (const value of values) scale = Math.max(scale, Math.abs(value));
  if (scale === 0) return 0;
  let sum = 0;
  for (const value of values) {
    const scaled = value / scale;
    sum += scaled * scaled;
  }
  return scale * Math.sqrt(sum);
}

function assertDimensions(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > AI_EMBEDDING_MAX_DIMENSIONS) {
    throw new AIEmbeddingError("AI_EMBEDDING_VECTOR_INVALID", "Embedding dimensions are outside the safe bound.");
  }
}
