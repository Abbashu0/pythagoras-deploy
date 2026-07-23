/**
 * /api/supabase-test — Quick connection + CRUD test for Supabase
 *
 * GET /api/supabase-test
 *   → Tests:
 *     1. Connection (env vars present)
 *     2. Read from `subjects` table
 *     3. Count rows in `registries`
 *     4. Count rows in `packages`
 *
 * Used to verify the Supabase migration is working end-to-end.
 */

import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/supabase-server";

export async function GET() {
  const results: Array<{
    test: string;
    status: "pass" | "fail";
    detail: string;
    ms?: number;
  }> = [];

  // 1. Env vars check
  const hasUrl = !!process.env.SUPABASE_URL;
  const hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  results.push({
    test: "Environment variables",
    status: hasUrl && hasKey ? "pass" : "fail",
    detail: hasUrl && hasKey
      ? "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY present"
      : `Missing: ${!hasUrl ? "SUPABASE_URL " : ""}${!hasKey ? "SUPABASE_SERVICE_ROLE_KEY" : ""}`,
  });

  if (!hasUrl || !hasKey) {
    return NextResponse.json({ ok: false, results });
  }

  const supabase = getSupabaseServer();

  // 2. Read subjects
  try {
    const start = Date.now();
    const { count, error } = await supabase
      .from("subjects")
      .select("*", { count: "exact", head: true });
    const ms = Date.now() - start;
    if (error) throw error;
    results.push({
      test: "Read subjects table",
      status: "pass",
      detail: `${count || 0} subjects found`,
      ms,
    });
  } catch (e) {
    results.push({
      test: "Read subjects table",
      status: "fail",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // 3. Count registries
  try {
    const start = Date.now();
    const { count, error } = await supabase
      .from("registries")
      .select("*", { count: "exact", head: true });
    const ms = Date.now() - start;
    if (error) throw error;
    results.push({
      test: "Read registries table",
      status: "pass",
      detail: `${count || 0} registry entries found`,
      ms,
    });
  } catch (e) {
    results.push({
      test: "Read registries table",
      status: "fail",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // 4. Count packages
  try {
    const start = Date.now();
    const { count, error } = await supabase
      .from("packages")
      .select("*", { count: "exact", head: true });
    const ms = Date.now() - start;
    if (error) throw error;
    results.push({
      test: "Read packages table",
      status: "pass",
      detail: `${count || 0} packages found`,
      ms,
    });
  } catch (e) {
    results.push({
      test: "Read packages table",
      status: "fail",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  const allPassed = results.every((r) => r.status === "pass");
  return NextResponse.json({
    ok: allPassed,
    results,
    timestamp: new Date().toISOString(),
  });
}
