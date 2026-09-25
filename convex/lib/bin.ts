/**
 * Kazakhstan BIN / IIN check: 12 digits and the control digit. Weights 1..11, sum mod 11; a result of 10
 * repeats with weights 3..11,1,2; 10 again means the number is invalid.
 */
export function isValidKzBin(value: string) {
  if (!/^\d{12}$/.test(value)) return false
  const digits = [...value].map(Number)
  const control = (weights: number[]) => weights.reduce((sum, weight, index) => sum + weight * digits[index], 0) % 11
  let check = control([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  if (check === 10) check = control([3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2])
  return check !== 10 && check === digits[11]
}
