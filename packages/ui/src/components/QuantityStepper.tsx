import styles from "./QuantityStepper.module.css";

/**
 * −/N/+ , 48px targets — the item-detail sheet's quantity control. Purely
 * a controlled display+callback pair; the caller owns what "quantity"
 * means (a cart line, a draft add) and any min/max clamping.
 */
export function QuantityStepper({
  quantity,
  onDecrease,
  onIncrease,
  min = 1,
  max,
}: {
  quantity: number;
  onDecrease: () => void;
  onIncrease: () => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className={styles.stepper}>
      <button
        type="button"
        className={styles.button}
        aria-label="Decrease quantity"
        disabled={quantity <= min}
        onClick={onDecrease}
      >
        −
      </button>
      <span className={styles.quantity}>{quantity}</span>
      <button
        type="button"
        className={styles.button}
        aria-label="Increase quantity"
        disabled={max !== undefined && quantity >= max}
        onClick={onIncrease}
      >
        +
      </button>
    </div>
  );
}
