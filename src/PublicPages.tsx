import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, Search, Wallet } from "lucide-react";
import { infoPages } from "./infoContent";
import { articles } from "./helpContent";
import { ErrorState } from "./ErrorState";
import { StoragePreferences } from "./InfoNavigation";
export function HelpCenter() {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("All topics");
  const categories = [
    "All topics",
    ...new Set(articles.map((a) => a.category)),
  ];
  const filtered = articles.filter(
    (a) =>
      (category === "All topics" || a.category === category) &&
      `${a.title} ${a.steps.join(" ")}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <span className="eyebrow">YOUR USER GUIDE</span>
      <h1>Help Center</h1>
      <p className="info-intro">
        Find your way around saving, currencies and your account.
      </p>
      <div className="help-filters">
        <label>
          Search help
          <span className="help-search-input">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Try round-ups, login or rates"
            />
          </span>
        </label>
        <label>
          Category
          <select
            aria-label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <p role="status" className="footnote">
        {filtered.length} articles found
      </p>
      <div className="help-articles">
        {filtered.map((a) => (
          <article className="panel" key={a.title}>
            <span className="eyebrow">{a.category}</span>
            <h2>{a.title}</h2>
            <ol>
              {a.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <a className="text-link" href={a.link}>
              {a.linkText}
            </a>
          </article>
        ))}
        {!filtered.length && (
          <p className="empty">
            No matching articles. Try a different phrase or category.
          </p>
        )}
      </div>
    </>
  );
}
export default function PublicPage({ path }: { path: string }) {
  const page = infoPages[path];
  useEffect(() => {
    document.title = `${path === "/help" ? "Help Center" : (page?.title ?? "Page not found")} · Dream Piggy Bank`;
  }, [path, page]);
  return (
    <div className="public-shell">
      <header className="public-header">
        <a className="brand" href="/#Home">
          <span className="brand-icon">
            <Wallet size={22} />
          </span>
          Dream Piggy Bank
        </a>
        <a className="text-link" href="/#Home">
          <ArrowLeft size={16} />
          Back to app
        </a>
      </header>
      <main className="info-main">
        {path === "/help" ? (
          <HelpCenter />
        ) : path === "/storage-preferences" ? (
          <>
            <h1>Privacy and storage</h1>
            <StoragePreferences />
          </>
        ) : page ? (
          <>
            <span className="eyebrow">DREAM PIGGY BANK · INFORMATION</span>
            <h1>{page.title}</h1>
            <p className="info-intro">{page.intro}</p>
            <div className="editorial-sections">
              {page.sections.map((section) => (
                <section key={section.heading}>
                  <h2>{section.heading}</h2>
                  <p>{section.text}</p>
                </section>
              ))}
            </div>
            <a className="text-link" href="/help">
              <BookOpen size={16} />
              Visit the Help Center
            </a>
          </>
        ) : (
          <ErrorState status={404} />
        )}
      </main>
    </div>
  );
}
