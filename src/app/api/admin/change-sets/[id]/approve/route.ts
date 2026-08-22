import type { NextRequest } from "next/server";
import { runTransition } from "../_transition";
export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) { return runTransition(request, (await context.params).id, "approve"); }
