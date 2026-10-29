import { useCallback, useEffect, useState } from "react";

function getInitialValue(initialValue) {
  return typeof initialValue === "function" ? initialValue() : initialValue;
}

function readValue(key, initialValue) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? getInitialValue(initialValue) : JSON.parse(stored);
  } catch {
    return getInitialValue(initialValue);
  }
}

export function usePersistentState(key, initialValue) {
  const [entry, setEntry] = useState(() => ({
    key,
    value: readValue(key, initialValue),
  }));

  const value = entry.key === key ? entry.value : readValue(key, initialValue);

  useEffect(() => {
    if (entry.key !== key) {
      setEntry({ key, value: readValue(key, initialValue) });
      return;
    }

    try {
      localStorage.setItem(key, JSON.stringify(entry.value));
    } catch {
      // Browser storage may be unavailable or full.
    }
  }, [entry, initialValue, key]);

  const setValue = useCallback((nextValue) => {
    setEntry((current) => {
      const currentValue = current.key === key
        ? current.value
        : readValue(key, initialValue);

      return {
        key,
        value: typeof nextValue === "function"
          ? nextValue(currentValue)
          : nextValue,
      };
    });
  }, [initialValue, key]);

  return [value, setValue];
}
