/**
 * useDebounce — debounces a value so expensive operations (e.g. API
 * calls) are not triggered on every keystroke.
 */

import { useEffect, useState } from 'react';

/**
 * @param {*} value
 * @param {number} [delay=300]
 * @returns {*}
 */
export const useDebounce = (value, delay = 300) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
};

export default useDebounce;