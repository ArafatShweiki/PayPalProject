export const infoLinks = [
  ["/about", "About Us"],
  ["/help", "Help Center"],
  ["/privacy-policy", "Privacy Policy"],
  ["/terms-of-use", "Terms of Use"],
  ["/cookie-policy", "Cookie Policy"],
  ["/acceptable-use", "Acceptable Use"],
  ["/disclaimer", "Financial Disclaimer"],
  ["/contact", "Support information"],
] as const;
export function InfoFooter() {
  return (
    <footer className="info-footer">
      <span>Dream Piggy Bank · Development prototype</span>
      <div aria-label="Information links">
        {infoLinks.map(([href, label]) => (
          <a key={href} href={href}>
            {label}
          </a>
        ))}
      </div>
    </footer>
  );
}
export function StoragePreferences() {
  return (
    <section className="panel storage-preferences">
      <h2>Storage preferences</h2>
      <p>
        Only necessary sign-in storage is used by this application. There are no
        optional analytics or marketing categories.
      </p>
      <details>
        <summary>Review necessary storage</summary>
        <p>
          Sign-in uses necessary browser storage and cookies. Recently loaded
          account information is kept temporarily in memory.
        </p>
        <p>
          Use Sign out to end your session. Browser site-data controls can
          remove necessary storage and may require sign-in again.
        </p>
      </details>
      <a className="text-link" href="/cookie-policy">
        Read the Cookie Policy
      </a>
    </section>
  );
}
