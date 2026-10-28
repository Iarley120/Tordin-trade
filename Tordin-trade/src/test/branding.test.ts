import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
describe("identidade visual", () => {
  it("usa o título e o favicon próprios", () => {
    const root = read("src/routes/__root.tsx");
    expect(root).toContain("Tordin Trade | Plataforma de Trading");
    expect(root).toContain("/favicon.svg");
    expect(read("src/routes/index.tsx")).toContain("Tordin Trade | Plataforma de Trading");
  });
  it("favicon TT existe e o ícone antigo foi substituído", () => {
    expect(existsSync(resolve(root, "public/favicon.svg"))).toBe(true);
    const ico = readFileSync(resolve(root, "public/favicon.ico"));
    expect(createHash("sha256").update(ico).digest("hex")).not.toBe(
      "dd821076a9b03adc2173c93956226aea3d92482d7578fc4339c5d3a2e9c24586",
    );
  });
  it("não há referência visual ao Lovable no HTML/UI", () => {
    for (const f of [
      "src/routes/__root.tsx",
      "src/routes/index.tsx",
      "src/components/TradingPanel.tsx",
    ]) {
      expect(
        read(f)
          .toLowerCase()
          .replace(/reportlovableerror|lovable-error-reporting/g, ""),
      ).not.toContain("lovable");
    }
  });
});
