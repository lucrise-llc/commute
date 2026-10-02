export function subtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function shipping(total) {
  return total >= 50 ? 0 : 5;
}
