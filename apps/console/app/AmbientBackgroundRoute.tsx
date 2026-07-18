"use client";

import { usePathname } from "next/navigation";
import { AmbientBackground } from "@restrobooth/ui";

/**
 * The route-awareness packages/ui deliberately doesn't have (see
 * AmbientBackground's own header comment — no next dependency there).
 * Console is the one app where the ambient layer actually animates, and
 * only on /login — every other Console route is a dense working screen
 * even though Console's density otherwise allows motion.
 */
export function AmbientBackgroundRoute() {
  const pathname = usePathname();
  const isLogin = pathname != null && /\/login(\/|$)/.test(pathname);
  return <AmbientBackground mode={isLogin ? "animate" : "static"} />;
}
