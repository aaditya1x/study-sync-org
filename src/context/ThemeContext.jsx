
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const ThemeContext = createContext(null);
const STORAGE_KEY = "campusflow-theme";

export const THEMES = [
  { value: "light", label: "Clean Light", description: "Clean and minimal" },
  { value: "dark", label: "Obsidian Dark", description: "Classic dark workspace" },
  { value: "cyber", label: "Cyber Purple", description: "Electric violet accents" },
  { value: "midnight", label: "Midnight Neon", description: "Blue and purple glow" },
  { value: "sunset", label: "Warm Sunset", description: "Warm orange tones" },
  { value: "forest", label: "Forest Emerald", description: "Natural green tones" },
  { value: "ocean", label: "Deep Ocean", description: "Calm blue palette" },
  { value: "rose", label: "Neon Rose", description: "Pink and rose accents" },
  { value: "solar", label: "Obsidian Gold", description: "Gold on dark surfaces" },
  { value: "sage", label: "Forest Sage", description: "Soft green and cream" },
];

const VALID_THEMES = new Set([
  ...THEMES.map((item) => item.value),
  "system",
]);

function getInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return VALID_THEMES.has(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme);

  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false
  );

  useEffect(() => {
    if (!window.matchMedia) return undefined;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event) => setSystemDark(event.matches);

    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  const resolvedTheme =
    theme === "system"
      ? systemDark
        ? "dark"
        : "light"
      : theme;

  useEffect(() => {
    const root = document.documentElement;

    root.dataset.theme = resolvedTheme;
    root.dataset.palette = theme;

    const darkThemes = [
      "dark",
      "cyber",
      "midnight",
    ];

    root.style.colorScheme = darkThemes.includes(resolvedTheme)
      ? "dark"
      : "light";

    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage may be unavailable.
    }
  }, [theme, resolvedTheme]);

  const setTheme = useCallback((nextTheme) => {
    if (VALID_THEMES.has(nextTheme)) {
      setThemeState(nextTheme);
    }
  }, []);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      themes: THEMES,
    }),
    [theme, resolvedTheme, setTheme]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }

  return context;
}
