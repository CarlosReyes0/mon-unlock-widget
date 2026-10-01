/**
 * Shared product navigation for Open Paywall static pages.
 *
 * Placeholders (optional):
 *   <div id="site-nav"></div>
 *   <div id="site-footer"></div>
 * Then: <script src="/site-nav.js"></script> near end of <body>
 */
(function () {
  const PRODUCT_LINKS = [
    { href: "/", nav: "articles", label: "Articles" },
    { href: "/demo", nav: "demo", label: "Demo" },
    { href: "/account.html", nav: "account", label: "Account" },
    { href: "/dashboard.html", nav: "dashboard", label: "Dashboard" },
    { href: "/agents", nav: "agents", label: "Agents" },
  ];

  function isActive(nav, path) {
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
    if (nav === "account") return path.includes("account");
    if (nav === "dashboard") return path.includes("dashboard");
    if (nav === "agents") return path.includes("agents") || path.includes("skill");
    return false;
  }

  function renderNav(el, path) {
    if (!el || el.dataset.rendered === "1") return;
    el.dataset.rendered = "1";
    el.setAttribute("role", "navigation");
    el.setAttribute("aria-label", "Product");
    el.style.cssText =
      "display:flex;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap;align-items:center;";

    for (const link of PRODUCT_LINKS) {
      const a = document.createElement("a");
      a.href = link.href;
      a.dataset.nav = link.nav;
      a.textContent = link.label;
      const active = isActive(link.nav, path);
      a.style.cssText = active
        ? "font-size:0.875rem;color:#7c3aed;font-weight:600;text-decoration:none;"
        : "font-size:0.875rem;color:#57534e;font-weight:400;text-decoration:none;";
      el.appendChild(a);
    }
  }

  function renderFooter(el) {
    if (!el || el.dataset.rendered === "1") return;
    el.dataset.rendered = "1";
    el.style.cssText =
      "margin-top:3rem;padding-top:1.25rem;border-top:1px solid #e7e5e4;font-size:0.75rem;color:#78716c;";
    el.innerHTML =
      'Need HTML for your own site? <a href="/generator.html" style="color:#57534e;">Create embed</a><br/>' +
      'Agents: <a href="/llms.txt" style="color:#57534e;">llms.txt</a> · ' +
      '<a href="/agents.md" style="color:#57534e;">agents.md</a> · ' +
      '<a href="/openapi.json" style="color:#57534e;">OpenAPI</a><br/>' +
      '<span style="color:#a8a29e;">Developer examples (not free demos):</span> ' +
      '<a href="/connect-demo.html" style="color:#57534e;">Stripe Connect onboarding</a> · ' +
      '<a href="/connect-store.html" style="color:#57534e;">Connect marketplace</a>';
  }

  function mount() {
    const path = location.pathname || "/";
    renderNav(document.getElementById("site-nav"), path);
    renderFooter(document.getElementById("site-footer"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
