import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

/**
 * The console's chrome. Framework-agnostic by construction (ADR-0001): it
 * takes `nav` and `actions` as ReactNode rather than importing a router,
 * so the consuming app supplies its own <Link>. `shellClasses` below
 * exports the styling those links need — the app owns navigation, this
 * package owns how it looks.
 */
export function AppShell({
  nav,
  actions,
  children,
}: {
  nav?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a href="/" className={styles.mark} aria-label="RestroBooth home">
            {/* The mark IS the signature element — a state rail, mid-service.
                Not a generic glyph; the product's own visual language. */}
            <span className={styles.markRail} aria-hidden="true" />
            <span>
              Restro<span className={styles.markDim}>Booth</span>
            </span>
          </a>
          {nav && (
            <nav className={styles.nav} aria-label="Primary">
              {nav}
            </nav>
          )}
          <div className={styles.spacer} />
          {actions && <div className={styles.user}>{actions}</div>}
        </div>
      </header>
      <main className={styles.main} id="main">
        {children}
      </main>
    </div>
  );
}

/** Editorial page header — the one place the Console goes big. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.pageHead}>
      <div>
        <h1 className={styles.pageTitle}>{title}</h1>
        {subtitle && <p className={styles.pageSub}>{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

/**
 * Class names for app-owned navigation links. The app renders its
 * framework's <Link> and applies these — that's what keeps this package
 * free of any router dependency.
 */
export const shellClasses = {
  navLink: styles.navLink,
  userEmail: styles.userEmail,
} as const;
