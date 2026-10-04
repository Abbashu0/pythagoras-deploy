import assert from "node:assert/strict";
import test from "node:test";
import { Bot, BrainCircuit } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider as TooltipProvider } from "@radix-ui/react-tooltip";
import { Sidebar } from "../src/components/admin-ui/navigation/sidebar";

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
    collapsible: true,
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

function renderSidebar(pathname: string) {
  return renderToStaticMarkup(createElement(TooltipProvider, null,
    createElement(Sidebar, { sections, pathname, collapsed: false, pinnable: false }),
  ));
}

test("Sidebar selects the current destination without selecting its ancestor group", () => {
  const markup = renderSidebar("/admin/ai/agent-1/runtime");
  assert.equal((markup.match(/\bbg-selected\b/g) ?? []).length, 1);
  assert.equal((markup.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(markup, /<a(?=[^>]*href="\/admin\/ai\/agent-1\/runtime")(?=[^>]*aria-current="page")[^>]*>/);
});

test("Sidebar retains one current destination on a nested detail route", () => {
  const markup = renderSidebar("/admin/ai/models/example");
  assert.equal((markup.match(/\bbg-selected\b/g) ?? []).length, 1);
  assert.equal((markup.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(markup, /<a(?=[^>]*href="\/admin\/ai\/models")(?=[^>]*aria-current="page")[^>]*>/);
});
