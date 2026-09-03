const LINKS = [
  { href: "/", nav: "home", label: "Home" },
  { href: "/articles", nav: "articles", label: "Articles" },
  { href: "/generator.html", nav: "embed", label: "Create embed" },
  { href: "/account.html", nav: "account", label: "Account" },
  { href: "/dashboard.html", nav: "dashboard", label: "Dashboard" },
  { href: "/agents", nav: "agents", label: "Agents" },
] as const;

function isActive(nav: string) {
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  if (nav === "home") return path === "/" || path.endsWith("/index.html");
  if (nav === "articles")
    return (
      path === "/articles" ||
      path.startsWith("/articles/") ||
      path.endsWith("/articles.html") ||
      path.endsWith("/article.html")
    );
  if (nav === "embed") return path.includes("generator");
  if (nav === "account") return path.includes("account");
  if (nav === "dashboard") return path.includes("dashboard");
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
      Dev tools: <a href="/connect-demo.html">Connect sample</a> ·{" "}
      <a href="/connect-store.html">Sample storefront</a>
    </footer>
  );
}
