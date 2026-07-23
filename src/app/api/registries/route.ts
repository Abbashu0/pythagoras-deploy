/**
 * /api/registries — Registry entries API
 *
 * GET /api/registries                → list all registries (grouped)
 * GET /api/registries?name=subjects  → list entries in a specific registry
 * POST /api/registries               → create a new entry
 * PATCH /api/registries              → update an entry
 * DELETE /api/registries?id=xxx      → delete an entry
 */

import { NextRequest, NextResponse } from "next/server";
import { registryRepository } from "@/lib/repositories";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name") || "";
    const activeOnly = searchParams.get("active") === "true";

    if (name) {
      const entries = activeOnly
        ? await registryRepository.getActive(name)
        : await registryRepository.getByRegistryName(name);
      return NextResponse.json({ registry: name, entries, total: entries.length });
    }

    // No specific registry — return all registry names.
    const names = await registryRepository.getRegistries();

    // Optionally load entries for each registry (one round-trip per registry).
    const grouped: Record<string, unknown[]> = {};
    await Promise.all(
      names.map(async (n) => {
        grouped[n] = activeOnly
          ? await registryRepository.getActive(n)
          : await registryRepository.getByRegistryName(n);
      })
    );

    return NextResponse.json({
      registries: names,
      entries: grouped,
      total: names.length,
    });
  } catch (error) {
    console.error("[api/registries] GET error:", error);
    return NextResponse.json({ registries: [], entries: {}, total: 0 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.registry || !body.key || !body.label) {
      return NextResponse.json(
        { error: "registry, key, and label are required" },
        { status: 400 }
      );
    }

    // Check for duplicate.
    const existing = await registryRepository.getByKey(body.registry, body.key);
    if (existing) {
      return NextResponse.json(
        { error: `Entry with key "${body.key}" already exists in registry "${body.registry}"` },
        { status: 409 }
      );
    }

    const entry = await registryRepository.create({
      registry: body.registry,
      key: body.key,
      label: body.label,
      englishLabel: body.englishLabel || null,
      iconKey: body.iconKey || null,
      color: body.color || null,
      order: body.order ?? 0,
      active: body.active ?? true,
      metadata: body.metadata || {},
    } as never);

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    console.error("[api/registries] POST error:", error);
    return NextResponse.json(
      { error: "Failed to create registry entry", details: String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "Entry ID required" }, { status: 400 });
    }

    const updated = await registryRepository.update(id, updates);
    if (!updated) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, entry: updated });
  } catch (error) {
    console.error("[api/registries] PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update entry", details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Entry ID required" }, { status: 400 });
    }

    const ok = await registryRepository.delete(id);
    if (!ok) {
      return NextResponse.json({ error: "Failed to delete entry" }, { status: 500 });
    }

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("[api/registries] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete entry", details: String(error) },
      { status: 500 }
    );
  }
}
