import assert from "node:assert/strict";
import test from "node:test";
import { Bot, BrainCircuit } from "lucide-react";

import {
  flattenNav,
  isNavItemActive,
  resolveNavTrail,
  type NavSection,
} from "../src/components/admin-ui/navigation/nav-config";

const sections: NavSection[] = [
  {
    key: "ai",
    label: "الذكاء الاصطناعي",
    items: [
      { key: "models", label: "النماذج والمزوّدون", href: "/admin/ai/models", icon: BrainCircuit },
      {
        key: "agent-1",
        label: "Agent 1",
        href: "/admin/ai/agent-1",
        icon: Bot,
        children: [
          { key: "runtime", label: "التشغيل", href: "/admin/ai/agent-1/runtime" },
        ],
      },
    ],
  },
];

test("nested Admin navigation resolves full breadcrumb trail and active ancestor", () => {
  const resolved = resolveNavTrail(sections, "/admin/ai/agent-1/runtime");
  assert.deepEqual(resolved?.trail.map((item) => item.label), ["Agent 1", "التشغيل"]);
  assert.equal(isNavItemActive(sections[0].items[1], "/admin/ai/agent-1/runtime"), true);
  assert.deepEqual(flattenNav(sections).map((item) => item.key), ["models", "agent-1", "runtime"]);
});
