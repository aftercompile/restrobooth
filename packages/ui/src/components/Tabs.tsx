"use client";

import { useState, type ReactNode } from "react";
import styles from "./Tabs.module.css";

export type TabItem = { id: string; label: string; content: ReactNode };

export function Tabs({ items, defaultTabId }: { items: TabItem[]; defaultTabId?: string }) {
  const [activeId, setActiveId] = useState(defaultTabId ?? items[0]?.id);
  const active = items.find((t) => t.id === activeId) ?? items[0];

  return (
    <div>
      <div className={styles.list} role="tablist">
        {items.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === activeId}
            aria-controls={`rb-tabpanel-${t.id}`}
            id={`rb-tab-${t.id}`}
            className={styles.tab}
            onClick={() => setActiveId(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {active && (
        <div role="tabpanel" id={`rb-tabpanel-${active.id}`} aria-labelledby={`rb-tab-${active.id}`}>
          {active.content}
        </div>
      )}
    </div>
  );
}
