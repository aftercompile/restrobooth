// Direction B ("Service Board") — docs/DESIGN.md, DECISIONS.md. Import
// "@restrobooth/ui/tokens.css" once at the app root; everything else is a
// component.
export { DensityProvider, useDensity, type Density } from "./DensityProvider";

// Motion. Read src/motion.tsx's header before animating ANYTHING: POS and
// KDS get zero animation, and because Framer Motion animates from JS it
// ignores the CSS kill-switch — the guard is structural, via <Animate>.
export {
  Animate,
  useMotionAllowed,
  motion,
  AnimatePresence,
  CONSOLE_TRANSITION,
  BOOTH_TRANSITION,
  ENTER,
} from "./motion";

export { AppShell, PageHeader, shellClasses } from "./components/AppShell";
export { StateRail, type RailState } from "./components/StateRail";
export { Button, type ButtonVariant } from "./components/Button";
export { Input } from "./components/Input";
export { Select } from "./components/Select";
export { Textarea } from "./components/Textarea";
export { MoneyInput } from "./components/MoneyInput";
export { parseRupeesToPaise, formatPaiseAsRupees } from "./components/money";
export { Badge, type BadgeTone } from "./components/Badge";
export { Card, CardHeader } from "./components/Card";
export { DataRow } from "./components/DataRow";
export { Dialog } from "./components/Dialog";
export { Tabs, type TabItem } from "./components/Tabs";
export { TabularNumber } from "./components/TabularNumber";
export { ToastProvider, useToast, type ToastTone } from "./components/Toast";
