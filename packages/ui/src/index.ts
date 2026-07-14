// Direction B ("Service Board") — docs/DESIGN.md, DECISIONS.md. Import
// "@restrobooth/ui/tokens.css" once at the app root; everything else is a
// component.
export { DensityProvider, useDensity, type Density } from "./DensityProvider";

export { StateRail, type RailState } from "./components/StateRail";
export { Button, type ButtonVariant } from "./components/Button";
export { Input } from "./components/Input";
export { Badge, type BadgeTone } from "./components/Badge";
export { Card } from "./components/Card";
export { DataRow } from "./components/DataRow";
export { Dialog } from "./components/Dialog";
export { Tabs, type TabItem } from "./components/Tabs";
export { TabularNumber } from "./components/TabularNumber";
export { ToastProvider, useToast, type ToastTone } from "./components/Toast";
