/** @template {string} T @param {readonly T[]} values @param {unknown} value @returns {value is T} */
export function oneOf(values, value) { return values.some(candidate=>candidate===value); }
