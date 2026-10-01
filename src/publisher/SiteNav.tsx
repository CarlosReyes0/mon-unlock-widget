const LINKS = [
  { href: "/", nav: "articles", label: "Articles" },
  { href: "/demo", nav: "demo", label: "Demo" },
  { href: "/account.html", nav: "account", label: "Account" },
  { href: "/agents", nav: "agents", label: "Agents" },
] as const;

function isActive(nav: string) {
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  if (nav === "demo")
    return path === "/demo" || path.endsWith("/demo.html") || path.endsWith("/index.html");
  if (nav === "articles")
    return (
      path === "/" ||
      path === "/articles" ||
      path.startsWith("/articles/") ||
      path.endsWith("/articles.html") ||
      path.endsWith("/article.html")
    );
  if (nav === "account") return path.includes("account") || path.includes("dashboard");
  if (nav === "agents") return path.includes("agents") || path.includes("skill");
  return false;
}

export function SiteNav() {
  return (
    <nav className="mon-site-nav" aria-label="Product">
      {LINKS.map((link) => (
        <a key={link.nav} href={link.href} className={isActive(link.nav) ? "active" : undefined}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="mon-site-footer">
      Need HTML for your own site? <a href="/generator.html">Create embed</a>
      <br />
      <span className="mon-site-footer-note">Developer examples (not free demos):</span>{" "}
      <a href="/connect-demo.html">Stripe Connect onboarding</a> ·{" "}
      <a href="/connect-store.html">Connect marketplace</a>
    </footer>
  );
}
