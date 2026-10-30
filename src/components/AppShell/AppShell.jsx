import styles from "./AppShell.module.css";
export default function AppShell({ children, collapsed = false }) {
  return <div className={`${styles.shell} ${collapsed ? styles.collapsed : ""}`}>{children}</div>;
}
