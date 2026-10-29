
import { useId } from "react";
import { Palette } from "lucide-react";
import { useTheme } from "../../context/ThemeContext.jsx";
import styles from "./ThemeSwitcher.module.css";

export default function ThemeSwitcher({ compact = false }) {
  const { theme, setTheme, themes } = useTheme();
  const id = useId();

  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ""}`}>
      <label className={styles.label} htmlFor={id}>
        <Palette size={17} />
        <span className={styles.labelText}>Theme</span>
      </label>

      <select
        id={id}
        className={styles.select}
        value={theme}
        onChange={(event) => setTheme(event.target.value)}
        aria-label="Select website color theme"
      >
        {theme === "system" && (
          <option value="system">System Default</option>
        )}

        {themes.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
